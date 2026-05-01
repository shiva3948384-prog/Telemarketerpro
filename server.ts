import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bodyParser from "body-parser";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/NewMessage.js";
import { CallbackQuery } from "telegram/events/CallbackQuery.js";
import { Button } from "telegram/tl/custom/button.js";
import nodeCron from "node-cron";
import pLimit from "p-limit";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import "dotenv/config";

// Supabase initialization
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_ANON_KEY || "";
let supabase: any;

if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log("Supabase Client Initialized");
  } catch (e) {
    console.error("Supabase Client Init Error:", e);
  }
} else {
  console.warn("SUPABASE_URL or SUPABASE_ANON_KEY missing. Supabase is disabled.");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ScheduledTask = {
    stop: () => void;
};

// Utility for Spintax/Spinning {Hi|Hello|Hey}
function spinText(text: string): string {
    if (!text) return "";
    return text.replace(/\{([^{}]+)\}/g, (match, options) => {
        const choices = options.split('|');
        return choices[Math.floor(Math.random() * choices.length)];
    });
}

function randomizeMessage(text: string): string {
    const spun = spinText(text);
    // Add variations to prevent hash collision
    const variations = ["", " ", "\u200B", "\u200C", "  "];
    const randomVar = variations[Math.floor(Math.random() * variations.length)];
    return spun + randomVar;
}

// Global Store
const activeClients: Map<string, TelegramClient> = new Map();
const invalidSessions: Set<string> = new Set(); // accountId
const accountOwners: Map<string, number> = new Map();
const activeJobs: Map<string, ScheduledTask> = new Map();
const logs: { id: string; time: string; msg: string; status: 'success' | 'info' | 'error' }[] = [];
const userStates: Map<number, { step: string; data?: any; warnings?: number }> = new Map();
const bannedUsers: Set<number> = new Set();
const userSelections: Map<number, Set<string>> = new Map();
const admins: Set<number> = new Set([6074120353, 8279468317]); // Bot Owners
const brandingDisabled: Set<number> = new Set();
const brandingInitialized: Set<string> = new Set(); // accountId
const templates: Map<number, string[]> = new Map();
const autoReplyRules: Map<number, Map<string, string>> = new Map();
const autoReplyEnabled: Set<number> = new Set();
const userBroadcastConfig: Map<number, { message?: string; interval?: number; sel?: Set<string> }> = new Map();
const mandatoryCache: Map<number, { joined: boolean, time: number }> = new Map();
const captchaAnswers: Map<number, number> = new Map();
const CACHE_TTL = 15 * 1000; // 15 seconds for snappier verification
let isMasterBotDegraded = false;
let isDataLoading = true;

// Persistence Data Types
type UserStats = {
  totalSent: number;
  totalGroups: number;
  lastCaptchaTime?: number;
  hasStartedLogger?: boolean;
};

type AccountRecord = {
  userId: number;
  accountId: string;
  session: string;
};

// Global Store
const userStatsTracker: Map<number, UserStats> = new Map();
const licenseKeys: Map<string, { userId: number | null, expiry: string }> = new Map();
const localAccountRecords: Map<string, AccountRecord> = new Map(); // accountId -> record

const DATA_FILE = path.join(process.cwd(), "bot_data.json");

// Local Persistence Fallback
function saveToLocal() {
  try {
    const data = {
      admins: Array.from(admins),
      bannedUsers: Array.from(bannedUsers),
      templates: Array.from(templates.entries()),
      autoReplyRules: Array.from(autoReplyRules.entries()).map(([k, v]) => [k, Object.fromEntries(v)]),
      autoReplyEnabled: Array.from(autoReplyEnabled),
      brandingDisabled: Array.from(brandingDisabled),
      brandingInitialized: Array.from(brandingInitialized),
      userStats: Array.from(userStatsTracker.entries()),
      licenseKeys: Array.from(licenseKeys.entries()),
      accounts: Array.from(localAccountRecords.values())
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Local save error:", e);
  }
}

function loadFromLocal() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    if (data.admins) data.admins.forEach((id: number) => admins.add(id));
    if (data.bannedUsers) data.bannedUsers.forEach((id: number) => bannedUsers.add(id));
    if (data.templates) data.templates.forEach(([k, v]: [number, string[]]) => templates.set(k, v));
    if (data.autoReplyRules) data.autoReplyRules.forEach(([k, v]: [number, any]) => autoReplyRules.set(k, new Map(Object.entries(v))));
    if (data.autoReplyEnabled) data.autoReplyEnabled.forEach((id: number) => autoReplyEnabled.add(id));
    if (data.brandingDisabled) data.brandingDisabled.forEach((id: number) => brandingDisabled.add(id));
    if (data.brandingInitialized) data.brandingInitialized.forEach((id: string) => brandingInitialized.add(id));
    if (data.userStats) data.userStats.forEach(([k, v]: [number, UserStats]) => userStatsTracker.set(k, v));
    if (data.licenseKeys) data.licenseKeys.forEach(([k, v]: [string, any]) => licenseKeys.set(k, v));
    if (data.accounts) {
        data.accounts.forEach((acc: AccountRecord) => {
            localAccountRecords.set(acc.accountId, acc);
        });
    }
    console.log("[DATA] Loaded fallback data from local JSON.");
  } catch (e) {
    console.error("Local load error:", e);
  }
}

// Authentication & Keys
const authenticatedUsers: Set<number> = new Set(); // Users who logged in with a key

// Admin Credentials from Environment
const ADMIN_USER = process.env.ADMIN_USERNAME || "TeleMarketerPro";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "gh12mn909";

// Persistence Helper
async function saveUserData(userId: number) {
  // Always save to local fallback first
  saveToLocal();
  
  if (!supabase) return;
  try {
    const stats = getUserStats(userId);
    const userTemplates = templates.get(userId) || [];
    const userRules = autoReplyRules.get(userId);
    const rulesObj = userRules ? Object.fromEntries(userRules) : {};
    const userBrandingInit = Array.from(brandingInitialized).filter(accId => accountOwners.get(accId) === userId);

    const payload = {
        id: userId,
        is_admin: admins.has(userId),
        is_banned: bannedUsers.has(userId),
        auto_reply_enabled: autoReplyEnabled.has(userId),
        branding_disabled: brandingDisabled.has(userId),
        total_sent: stats.totalSent || 0,
        total_groups: stats.totalGroups || 0,
        templates: userTemplates,
        auto_reply_rules: rulesObj,
        branding_initialized: userBrandingInit,
        last_captcha_at: stats.lastCaptchaTime ? new Date(stats.lastCaptchaTime).toISOString() : null,
        has_started_logger: stats.hasStartedLogger || false,
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from("users")
      .upsert(payload, { onConflict: 'id' });
    
    if (error) {
      if ((error as any).code === 'PGRST204') {
          // Schema cache error - retry without problematic columns
          const { branding_initialized, ...fallbackPayload } = payload as any;
          await supabase.from("users").upsert(fallbackPayload, { onConflict: 'id' });
      } else {
          console.error(`Supabase saveUserData error for ${userId}:`, typeof error === 'object' ? JSON.stringify(error) : error);
      }
    }
  } catch (err: any) {
    console.error(`Internal saveUserData error for ${userId}:`, err.message || err);
  }
}

async function saveAccount(userId: number, accountId: string, session: string) {
    // 1. Save to local first
    localAccountRecords.set(accountId, { userId, accountId, session });
    saveToLocal();

    if (!supabase) return;
    try {
        // First ensure user exists to satisfy FK
        await saveUserData(userId);

        const { error } = await supabase
          .from("accounts")
          .upsert({
            user_id: userId,
            account_id: accountId,
            string_session: session,
            added_at: new Date().toISOString()
          }, { onConflict: 'user_id,account_id' });
        
        if (error) throw error;
    } catch (err: any) {
        console.error(`Save account error:`, JSON.stringify(err, null, 2));
    }
}

async function removeAccountFromDb(userId: number, accountId: string) {
    // Remove from local cache
    localAccountRecords.delete(accountId);
    saveToLocal();

    if (!supabase) return;
    try {
        const { error } = await supabase
          .from("accounts")
          .delete()
          .match({ user_id: userId, account_id: accountId });
        
        if (error) throw error;
    } catch (err) {
        console.error(`Remove account error:`, err);
    }
}

async function loadAllData() {
  isDataLoading = true;
  // Always load from local first to ensure some state exists immediately
  loadFromLocal();

  // Try to reconnect fallback accounts immediately
  if (localAccountRecords.size > 0) {
      console.log(`[DATA] Loading ${localAccountRecords.size} accounts from local cache...`);
      localAccountRecords.forEach((acc, id) => {
          accountOwners.set(id, acc.userId);
          reconnectAccount(acc.userId, acc.accountId, acc.session);
      });
  }

  if (!supabase) {
    console.log("[DATA] Supabase connection not available. Loaded from local cache only.");
    isDataLoading = false;
    return;
  }
  try {
    console.log("[DATA] Fetching license keys from Supabase...");
    const { data: keys, error: keysError } = await supabase.from("license_keys").select("*");
    if (keysError) {
      console.error("[DATA] Supabase Error (license_keys):", keysError.message);
    } else if (keys) {
      keys.forEach((k: any) => {
        licenseKeys.set(k.key.trim(), { userId: k.user_id, expiry: k.expiry });
      });
      console.log(`[DATA] Loaded ${keys.length} license keys into memory.`);
    }

    console.log("[DATA] Fetching user accounts/profiles...");
    const { data: users, error: usersError } = await supabase.from("users").select("*");
    if (usersError) {
      console.error("[DATA] Supabase Error (users):", usersError.message);
    } else if (users) {
      for (const user of users) {
        const userId = Number(user.id);
        if (user.is_admin) admins.add(userId);
        if (user.is_banned) bannedUsers.add(userId);
        if (user.auto_reply_enabled) autoReplyEnabled.add(userId);
        if (user.branding_disabled) brandingDisabled.add(userId);
        if (user.templates) templates.set(userId, user.templates);
        if (user.auto_reply_rules) {
          const rulesMap = new Map(Object.entries(user.auto_reply_rules) as [string, string][]);
          autoReplyRules.set(userId, rulesMap);
        }
        if (user.branding_initialized && Array.isArray(user.branding_initialized)) {
          user.branding_initialized.forEach((accId: string) => brandingInitialized.add(accId));
        }
        if (user.total_sent !== undefined) {
            userStatsTracker.set(userId, { 
                totalSent: user.total_sent, 
                totalGroups: user.total_groups || 0,
                lastCaptchaTime: user.last_captcha_at ? new Date(user.last_captcha_at).getTime() : undefined,
                hasStartedLogger: user.has_started_logger || false
            });
        }
      }
      console.log(`[DATA] Loaded ${users.length} user profiles.`);
    }

    console.log("[DATA] Fetching all linked accounts from Supabase...");
    const { data: allAccounts, error: allAccError } = await supabase.from("accounts").select("*");
    if (allAccError) {
         console.error("[DATA] Supabase Error (all accounts):", allAccError.message);
    } else if (allAccounts) {
        const reconLimit = pLimit(2); // Reduced concurrency to avoid rate limits
        await Promise.all(allAccounts.map((acc: any, idx: number) => reconLimit(async () => {
            if (acc.string_session) {
                const userId = Number(acc.user_id);
                const accountId = acc.account_id;
                
                // If not already reconnected from local, do it now
                if (!activeClients.has(accountId)) {
                    accountOwners.set(accountId, userId);
                    // Update local cache
                    localAccountRecords.set(accountId, { userId, accountId, session: acc.string_session });
                    // Staggered login to prevent FloodWait during mass reconnect
                    await new Promise(resolve => setTimeout(resolve, idx * 500));
                    await reconnectAccount(userId, accountId, acc.string_session);
                }
            }
        })));
        saveToLocal(); // Update local file with any new accounts from DB
        console.log(`[DATA] Processed ${allAccounts.length} accounts total.`);
    }
  } catch (err) {
    console.error("[DATA] Fatal load error:", err);
  } finally {
    isDataLoading = false;
  }
}

async function reconnectAccount(userId: number, accountId: string, sessionStr: string) {
    try {
        const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, { 
            connectionRetries: 5,
            floodSleepThreshold: 60 // Wait up to 1 minute for flood waits automatically
        });
        await client.connect();
        const me = await client.getMe().catch(() => null) as Api.User | null;
        if (me) {
            setupAccountHandlers(userId, client, me);
            const accIdStr = me.id.toString();
            activeClients.set(accIdStr, client);
            accountOwners.set(accIdStr, userId);
            addLog(`Reconnected: ${me.firstName} (${me.id})`, 'info');
        }
    } catch (e) {
        console.error(`Failed to reconnect ${accountId}:`, e);
    }
}

function setupAccountHandlers(userId: number, client: TelegramClient, me: Api.User) {
    // Add Auto Reply Handler
    client.addEventHandler(async (ev: any) => {
       if (!autoReplyEnabled.has(userId)) return;
       const msg = ev.message;
       if (msg && msg.text) {
          const rules = autoReplyRules.get(userId);
          if (rules) {
             const reply = rules.get(msg.text.toLowerCase());
             if (reply) {
                try {
           await client.sendMessage(msg.peerId, { message: reply, replyTo: msg.id });
           addLog(`Auto-replied to "${msg.text}" using account ${me.id}`, 'success');
        } catch(e){}
     }
  }
}
}, new NewMessage({}));
}

function getUserStats(userId: number): UserStats {
  if (!userStatsTracker.has(userId)) {
    userStatsTracker.set(userId, { totalSent: 0, totalGroups: 0 });
  }
  return userStatsTracker.get(userId)!;
}

function updateStats(userId: number, sent: number, groups: number) {
  const stats = getUserStats(userId);
  stats.totalSent += sent;
  stats.totalGroups = Math.max(stats.totalGroups, groups);
  userStatsTracker.set(userId, stats);
  saveUserData(userId);
}

// Constants
const PORT = 3000;
const MANDATORY_CHANNELS = [
  { name: "📢 News Channel", username: "TeleMarketerProNews", url: "https://t.me/TeleMarketerProNews" },
  { name: "💬 Support Chat", username: "TeleMarketerProChatss", url: "https://t.me/TeleMarketerProChatss" },
  { name: "🔑 Smart Keys Daily", username: "smartkeysdailyofficial", url: "https://t.me/smartkeysdailyofficial" }
];

function addLog(msg: string, status: 'success' | 'info' | 'error' = 'info') {
  const log = {
    id: Math.random().toString(36).substr(2, 9),
    time: new Date().toLocaleTimeString(),
    msg,
    status
  };
  logs.unshift(log);
  if (logs.length > 50) logs.pop();
}

// Telegram App Config
const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
const apiHash = process.env.TELEGRAM_API_HASH || "";
const botToken = process.env.BOT_TOKEN || "7853685359:AAHKYuKYDqKAdAbBfAISg2Gxy7Zj0hZspPU";

if (!apiId || !apiHash) {
  console.warn("TELEGRAM_API_ID or TELEGRAM_API_HASH missing. BOT_TOKEN fallback used if available.");
}

// master bot persistence
let masterBotSession = process.env.MASTER_BOT_SESSION || "";
const masterBot = new TelegramClient(new StringSession(masterBotSession), apiId, apiHash, {
  connectionRetries: 10,
  floodSleepThreshold: 2000, // Handle long flood waits automatically
});

const LOGGER_BOT_TOKEN = process.env.LOGGER_BOT_TOKEN?.trim();
let loggerBot: TelegramClient | null = null;
let loggerBotReady = false;
let loggerBotUsername = "TeleMarketerLogsBot";

function isValidBotToken(token?: string): boolean {
    if (!token) return false;
    // Telegram Bot Token format: [0-9]+:[a-zA-Z0-9_-]{35}
    return /^[0-9]+:[a-zA-Z0-9_-]{35,}$/.test(token);
}

async function logToLoggerBot(userId: number, message: string) {
  if (!loggerBotReady || !loggerBot || !LOGGER_BOT_TOKEN) return;
  try {
    const stats = getUserStats(userId);
    if (stats.hasStartedLogger) {
      await loggerBot.sendMessage(userId, { message }).catch(() => {});
    }
  } catch (e) {
    console.error("LoggerBot send error:", e);
  }
}

async function initLoggerBot() {
    try {
        if (!LOGGER_BOT_TOKEN) {
            console.warn("⚠️ LOGGER_BOT_TOKEN is missing. Logger Bot will not be active.");
            return;
        }

        if (!isValidBotToken(LOGGER_BOT_TOKEN)) {
            console.error("❌ Invalid LOGGER_BOT_TOKEN format detected. Please check your Secret configuration.");
            return;
        }

        console.log("Attempting to initialize Logger Bot...");
        // Use a fresh instance with potential environment fallbacks if needed
        const effectiveApiId = apiId || 2040; // Fallback to a common API ID if missing, though user SHOULD provide it
        const effectiveApiHash = apiHash || "b18441a1ff607e10a989891a562527d9";

        loggerBot = new TelegramClient(new StringSession(""), effectiveApiId, effectiveApiHash, {
            connectionRetries: 5,
            floodSleepThreshold: 2000,
        });

        await loggerBot.start({
            botAuthToken: LOGGER_BOT_TOKEN
        });
        
        const me = await loggerBot.getMe().catch(() => null) as Api.User | null;
        if (me) {
            loggerBotUsername = me.username || "TeleMarketerLogsBot";
            loggerBotReady = true;
            console.log(`Logger Bot Initialized Successfully as @${loggerBotUsername}`);
        }
        
        loggerBot.addEventHandler(async (event: any) => {
            const message = event.message;
            if (!message || !message.peerId) return;
            const userId = Number(message.senderId);
            const text = message.text;
            
            if (text === "/start") {
                const stats = getUserStats(userId);
                const totalAccs = Array.from(accountOwners.entries()).filter(([_, owner]) => owner === userId).length;
                if (!stats.hasStartedLogger) {
                    stats.hasStartedLogger = true;
                    await saveUserData(userId);
                    await loggerBot!.sendMessage(userId, { 
                        message: `✅ **Logger Bot Started!**\n\nYou will now receive all your ad logs here.\n\n**Total Accounts:** ${totalAccs}` 
                    });
                } else {
                    await loggerBot!.sendMessage(userId, { 
                        message: `✅ **Logger Bot is already active.**\n\n**Total Accounts:** ${totalAccs}` 
                    });
                }
            }
        }, new NewMessage({}));
    } catch (e: any) {
        console.error("Logger Bot Init Error:", e);
        if (e.message?.includes("ACCESS_TOKEN_INVALID")) {
            console.error("CRITICAL: The Logger Bot Token provided is invalid or rejected by Telegram.");
        }
    }
}

async function checkAllAccountsBranding(userId: number) {
    if (brandingDisabled.has(userId)) return;
    const userAccs = Array.from(accountOwners.entries()).filter(([_, owner]) => owner === userId).map(([id]) => id);
    for (const accId of userAccs) {
        const client = activeClients.get(accId);
        if (client) {
            // Run in background without await if possible, but TG is sensitive to concurrent calls
            // GramJS handles ordering mostly.
            enforceProfileBranding(userId, accId, client).catch(() => null);
        }
    }
}

async function enforceProfileBranding(userId: number, accountId: string, client: TelegramClient) {
  if (brandingDisabled.has(userId)) return true;
  if (bannedUsers.has(userId)) return false;
  
  try {
    const me = await client.getMe().catch(() => null) as Api.User | null;
    if (!me) return true;

    const botUsername = (process.env.BOT_USERNAME || "TeleMarketerProBot").replace("@", "");
    const channelUsername = (MANDATORY_CHANNELS[0]?.username || "TeleMarketerProNews").replace("@", "");
    
    // Mandatory strings to detect (Case Insensitive)
    const expectedSuffix = `@${botUsername}`.toLowerCase();
    const expectedBio = `@${channelUsername}`.toLowerCase();
    
    // Check if branding already matches
    const currentLastName = (me.lastName || "").toLowerCase();
    const hasNameBranding = currentLastName.includes(expectedSuffix);
    
    // Check Bio - If API call fails, skip check to avoid false warnings
    const full: any = await client.invoke(new Api.users.GetFullUser({ id: me.id })).catch(() => "API_ERROR");
    if (full === "API_ERROR") return true; 

    const currentBio = (full?.fullUser?.about || "").toLowerCase();
    const hasBioBranding = currentBio.includes(expectedBio);

    // Initialization: Force set branding once if never seen before
    if (!brandingInitialized.has(accountId)) {
      brandingInitialized.add(accountId);
      saveToLocal();
      
      const targetSuffix = `via @${botUsername}`;
      const targetBio = `Free Automation Managed By @${channelUsername}`;
      
      await client.invoke(new Api.account.UpdateProfile({
        lastName: ((me.lastName || "").replace(/via\s+@\w+/gi, "").trim() + " " + targetSuffix).slice(0, 64),
        about: targetBio.slice(0, 70)
      })).catch(() => null);
      
      addLog(`[BRANDING] Initialized for account ${accountId.slice(0,6)}`, 'info');
      return true;
    }

    // Violation Check
    if (!hasNameBranding || !hasBioBranding) {
      // Restore branding
      const targetSuffix = `@${botUsername}`;
      const targetBio = `@${channelUsername}`;

      const finalLastName = currentLastName.includes(expectedSuffix) ? (me.lastName || "") : (me.lastName || "").replace(/via\s+@\w+/gi, "").trim() + ` via ${targetSuffix}`;
      const finalBio = currentBio.includes(expectedBio) ? (full?.fullUser?.about || "") : (full?.fullUser?.about || "").replace(/via\s+@\w+/gi, "").trim() + ` via ${targetBio}`;

      try {
        await client.invoke(new Api.account.UpdateProfile({
          lastName: finalLastName.slice(0, 64),
          about: finalBio.slice(0, 70)
        })).catch(() => null);
      } catch (e) {}
    }
    return true;
  } catch (e) {
    return true;
  }
}

function stopAllCampaignsForUser(userId: number) {
    for (const [accId, client] of activeClients.entries()) {
        if (accountOwners.get(accId) === userId) {
            const job = activeJobs.get(accId);
            if (job) {
                job.stop();
                activeJobs.delete(accId);
                addLog(`Emergency Stop: Campaign for account ${accId.slice(0,6)} halted due to user ban.`, 'error');
            }
        }
    }
}

// Broadcast Helper
async function runCycle(userId: number, accountId: string, client: TelegramClient, message: string) {
  try {
    if (bannedUsers.has(userId)) return;
    if (!client.connected) await client.connect();
    
    // Check Profile Branding
    const isBrandingOk = await enforceProfileBranding(userId, accountId, client);
    if (!isBrandingOk) return;

    const me = await client.getMe().catch(() => null) as Api.User | null;
    if (!me) throw new Error("AUTH_KEY_UNREGISTERED");

    const dialogs = await client.getDialogs();
    // Strict Target: Groups and Mega-groups ONLY (Exclude Channels and DM)
    const groups = dialogs.filter((d) => {
        const isStandardGroup = d.isGroup;
        // Supergroups are technically channels in TG schema, but behave like groups
        // @ts-ignore
        const isSupergroup = d.entity && d.entity.className === 'Channel' && !d.entity.broadcast;
        return isStandardGroup || isSupergroup;
    });
    
    if (groups.length === 0) {
        addLog(`No eligible groups found for account ${accountId.slice(0,6)}.`, 'error');
        await logToLoggerBot(userId, `❌ **Broadcast Skipped**\n\nAccount: \`${accountId.slice(0,8)}...\`\nReason: No groups joined or found.`);
        return;
    }

    const limit = pLimit(2); 
    let sentInThisCycle = 0;
    let failedInThisCycle = 0;
    
    addLog(`Initiating broadcast: Account ${accountId.slice(0,6)} targeting ${groups.length} groups`, 'info');

    await Promise.all(groups.map((group) =>
      limit(async () => {
        try {
          const finalMessage = randomizeMessage(message);
          
          // Add random delay between messages to avoid flood
          await new Promise(r => setTimeout(r, Math.random() * 3000 + 2000));
          
          const sentMsg = await client.sendMessage(group.id, { message: finalMessage });
          sentInThisCycle++;
          
          // Construct Group and Message Link
          let groupLink = "Group is Private 🔐";
          let msgLink = "";
          
          if (group.entity && 'username' in group.entity && group.entity.username) {
              groupLink = `https://t.me/${group.entity.username}`;
              msgLink = `\n**Msg Link:** https://t.me/${group.entity.username}/${sentMsg.id}`;
          } else {
              // Try to fallback to private link format if we have an ID
              // GramJS ids are large, need -100 prefix removed for c/ links
              const cleanId = group.id.toString().replace("-100", "");
              msgLink = `\n**Msg Link:** https://t.me/c/${cleanId}/${sentMsg.id}`;
          }

          // Detailed Success Logging
          await logToLoggerBot(userId, `📡 **Ad Sent Successfully!** ✅\n\n**Account:** \`${me.firstName} (${accountId.slice(0,8)}...)\`\n**Group:** \`${group.title}\`\n**Link:** ${groupLink}${msgLink}\n**Time:** \`${new Date().toLocaleTimeString()}\``);
          
        } catch (err: any) {
          failedInThisCycle++;
          const errMsg = err.message || 'Unknown Error';
          
          let groupLink = "Private Group";
          if (group.entity && 'username' in group.entity && group.entity.username) {
            groupLink = `@${group.entity.username}`;
          }

          await logToLoggerBot(userId, `❌ **Failed to Send Message**\n\n**Account:** \`${me.firstName}\`\n**Group:** \`${group.title || 'Unknown Group'}\`\n**Link/Username:** ${groupLink}\n**Reason:** \`${errMsg}\`\n**Time:** \`${new Date().toLocaleTimeString()}\``);
          
          addLog(`Send error on ${group.title}: ${errMsg}`, 'error');
        }
      })
    ));
    
    updateStats(userId, sentInThisCycle, groups.length);
    addLog(`Cycle completed for ${accountId}. Sent: ${sentInThisCycle}, Failed: ${failedInThisCycle}`, 'info');
    
    await logToLoggerBot(userId, `🏁 **Cycle Finished!**\n\nAccount: \`${me.firstName}\`\nSent: **${sentInThisCycle}**\nFailed: **${failedInThisCycle}**\nTotal: **${groups.length} groups**`);

  } catch (error: any) {
    console.error(`Cycle error for ${accountId}:`, error);
    addLog(`Critical failure for ${accountId}: ${error instanceof Error ? error.message : 'Unknown'}`, 'error');
    
    // Check for authorization error
    if (error.message && (error.message.includes("AUTH_KEY") || error.message.includes("SESSION_REVOKED") || error.message.includes("unregistered") || error.message.includes("USER_DEACTIVATED"))) {
        activeClients.delete(accountId);
        accountOwners.delete(accountId);
        activeJobs.get(accountId)?.stop();
        activeJobs.delete(accountId);
        await removeAccountFromDb(userId, accountId);
        masterBot.sendMessage(userId, { 
            message: `⚠️ **Account Logged Out!**\n\nThe Telegram session for \`${accountId.slice(0,8)}...\` has been terminated or revoked.\n\nPlease relogin to continue using this account.\n\nUser ID: \`${userId}\`` 
        }).catch(() => {});
    }
  }
}

async function startCampaignForAccount(userId: number, accountId: string, message: string, interval: number) {
  const client = activeClients.get(accountId);
  if (!client) return false;

  if (activeJobs.has(accountId)) {
    activeJobs.get(accountId)?.stop();
  }

  // Run first cycle immediately
  runCycle(userId, accountId, client, message);

  // Schedule next cycles
  const cronExpression = `*/${interval} * * * *`;
  const job = nodeCron.schedule(cronExpression, () => runCycle(userId, accountId, client, message));

  activeJobs.set(accountId, job);
  
  await logToLoggerBot(userId, `🚀 **Campaign Started!**\n\nAccount: \`${accountId.slice(0,8)}...\`\nInterval: **${interval} min**\nMessage: \`${message.slice(0,50)}...\``);
  
  return true;
}

// Menus
async function checkMandatory(userId: number, forceCheck: boolean = false) {
  if (isMasterBotDegraded) return true; 
  
  const cached = mandatoryCache.get(userId);
  if (!forceCheck && cached && (Date.now() - cached.time < CACHE_TTL)) {
      return cached.joined;
  }

  // Parallel best-effort check
  const check = async () => {
    if (!masterBot.connected) return true;
    try {
      const results = await Promise.all(MANDATORY_CHANNELS.map(async (channel) => {
        try {
          // Use GetParticipant which is very lightweight
          await masterBot.invoke(new Api.channels.GetParticipant({
            channel: channel.username,
            participant: userId.toString()
          }));
          return true;
        } catch (e: any) {
          // If error is USER_NOT_PARTICIPANT, they definitely haven't joined
          if (e.message && e.message.includes("USER_NOT_PARTICIPANT")) {
            return false;
          }
          // For other errors (like rate limits), assume true to not block users
          return true;
        }
      }));
      return results.every(v => v === true);
    } catch {
      return true;
    }
  };

  // Fast-pass if bot is flooded
  if (isMasterBotDegraded) return true;

  // Reduced timeout but returned false on timeout to be safer for mandatory join when forced
  const joined = await Promise.race([
    check(),
    new Promise<boolean>(res => setTimeout(() => res(!forceCheck), 4000)) // Use 4s and return false if forced
  ]);

  mandatoryCache.set(userId, { joined, time: Date.now() });
  return joined;
}

const getMainMenuButtons = (userId: number, isAdminUser: boolean) => {
  const userAccs = Array.from(accountOwners.entries()).filter(([_, owner]) => owner === userId).map(([id]) => id);
  const isAnyBroadcasting = userAccs.some(id => activeJobs.has(id));

  const btns = [
    [Button.inline("📈 Dashboard", Buffer.from("menu_dashboard"))],
    [
      Button.inline("➕ Add Account", Buffer.from("menu_add_account")),
      Button.inline("📊 My Accounts", Buffer.from("menu_my_accounts"))
    ],
    [Button.inline(isAnyBroadcasting ? "🛑 Stop Broadcast" : "🚀 Start Broadcast", Buffer.from("menu_broadcast"))],
    [
      Button.inline("📣 Post Ad Menu", Buffer.from("menu_ad_menu")),
      Button.inline("🤖 Auto Reply", Buffer.from("menu_auto_reply"))
    ],
    [Button.url("✨ Remove Branding", "https://t.me/NoPasswordNo")],
    [Button.url("👨‍💻 Support/Owner", "https://t.me/NoPasswordNo")]
  ];
  if (isAdminUser) {
    btns.push([Button.inline("👑 Admin Panel", Buffer.from("menu_admin"))]);
  }
  btns.push([Button.inline("ℹ️ About", Buffer.from("menu_about"))]);
  return btns;
};

const getBroadcastAccountButtons = (userId: number, currentSel: Set<string>) => {
    const userAccs = Array.from(accountOwners.entries())
        .filter(([_, owner]) => owner === userId)
        .map(([id]) => id);
    
    const btns = [];
    for (let i = 0; i < userAccs.length; i += 2) {
        const row = [];
        const acc1 = userAccs[i];
        const isBroadcasting1 = activeJobs.has(acc1);
        const isInvalid1 = invalidSessions.has(acc1);
        row.push(Button.inline(`${isInvalid1 ? "⚠️" : (currentSel.has(acc1) ? "✅" : (isBroadcasting1 ? "🟢" : "🔘"))} ${acc1.slice(0,8)}`, Buffer.from(`toggle_${acc1}`)));
        
        if (userAccs[i+1]) {
            const acc2 = userAccs[i+1];
            const isBroadcasting2 = activeJobs.has(acc2);
            const isInvalid2 = invalidSessions.has(acc2);
            row.push(Button.inline(`${isInvalid2 ? "⚠️" : (currentSel.has(acc2) ? "✅" : (isBroadcasting2 ? "🟢" : "🔘"))} ${acc2.slice(0,8)}`, Buffer.from(`toggle_${acc2}`)));
        }
        btns.push(row);
    }
    return btns;
};

async function initMasterBot() {
  if (!botToken || !apiId || !apiHash) return;
  
  // 1. Register Handlers FIRST so they are ready as soon as the bot connects
  setupMasterBotHandlers();

  try {
    console.log("Starting Master Bot...");
    // Assume degraded until proven otherwise if bot is fresh (no session string)
    if (!masterBotSession) isMasterBotDegraded = true;

    // Start data loading IN PARALLEL so secondary accounts can work even if master is flooded
    loadAllData();

    // 2. Start logic
    try {
      await masterBot.start({ 
        botAuthToken: botToken,
        onError: (err) => {
           if (err.message && err.message.includes("FLOOD")) {
             isMasterBotDegraded = true;
             console.error("[FLOOD] Master bot triggered flood wait. The bot will resume automatically after the wait.");
           } else {
             console.error("Master Bot Error handler:", err);
           }
        }
      });
      isMasterBotDegraded = false;
      console.log("Master Bot Connected Successfully.");
    } catch (e: any) {
      if (e.errorMessage === "FLOOD" || (e.message && e.message.includes("FLOOD"))) {
        isMasterBotDegraded = true;
        const waitTime = e.seconds || 1630;
        console.error(`[CRITICAL] Master Bot Login blocked by Telegram FloodLimit. Bot will wait for ${waitTime}s.`);
        addLog(`MASTER_BOT_FLOOD: Bot is waiting ${waitTime}s to resume.`, 'error');
      } else {
        throw e;
      }
    }
    
    // 3. Save Session
    if (!masterBotSession) {
      const saved = masterBot.session.save() as unknown as string;
      if (saved) {
        console.log("Master Bot Initialized with Session. Please save this to MASTER_BOT_SESSION env to avoid FloodWait next time:");
        console.log(saved);
        addLog(`MASTER_BOT_SESSION_CODE: ${saved}`, 'success');
      }
    }

    // Initialize Logger Bot
    await initLoggerBot();

    const botMe = await masterBot.getMe().catch(() => null) as Api.User | null;
    if (botMe) {
      const botUsername = botMe.username || "TeleMarketerProBot";
      process.env.BOT_USERNAME = botUsername;
      console.log(`Bot initialized as @${botUsername}`);
    }

  } catch (e) {
    console.error("Fatal Master Bot Initialization Error:", e);
  }
}

function setupMasterBotHandlers() {
    masterBot.addEventHandler(async (event: any) => {
      const message = event.message;
      if (!message || !message.peerId) return;
      const userId = Number(message.senderId);
      if (bannedUsers.has(userId)) {
        await masterBot.sendMessage(userId, { message: "You Are Banned From Our Bot Please contact support @NoPasswordNo" });
        return;
      }

      const state = userStates.get(userId);
      const isAdminUser = admins.has(userId);

      if (state) {
        if (state.step === "awaiting_captcha") {
            const answer = parseInt(message.text);
            const expected = captchaAnswers.get(userId);
            if (expected !== undefined && answer === expected) {
                captchaAnswers.delete(userId);
                userStates.delete(userId);
                
                const stats = getUserStats(userId);
                stats.lastCaptchaTime = Date.now();
                await saveUserData(userId);
                
                // Now check mandatory membership
                const joined = await checkMandatory(userId);
                if (!joined && !isAdminUser) {
                    const btns: any[] = MANDATORY_CHANNELS.map(c => [Button.url(c.name, c.url)]);
                    btns.push([Button.inline("🔄 I Have Joined", Buffer.from("verify_join"))]);
                    await masterBot.sendMessage(userId, { 
                        message: `✅ **Human Verified!**\n\n⚠️ **Membership Required!**\n\nPlease join our mandatory channels to use the bot services:`, 
                        buttons: btns 
                    });
                } else {
                    await masterBot.sendMessage(userId, {
                        message: `✅ **Verified!**\n\n🚀 **Welcome to TeleMarketerPro Bot!**\n\nThe most professional ad management bot on Telegram.\n\nUse the buttons below to navigate:`,
                        buttons: getMainMenuButtons(userId, isAdminUser)
                    });
                }
            } else {
                await masterBot.sendMessage(userId, { message: "❌ **Incorrect answer.** Please try again or re-send /start" });
            }
            return;
        }

        if (state.step === "awaiting_session") {
          let sessionStr = "";
          if (message.media && message.media instanceof Api.MessageMediaDocument) {
            const buffer = await masterBot.downloadMedia(message.media);
            sessionStr = buffer.toString().trim();
          } else if (message.text) {
            sessionStr = message.text.trim();
          }

          if (sessionStr) {
            const prog = await masterBot.sendMessage(userId, { message: "⌛ **Connecting...**" });
            try {
              const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, { connectionRetries: 5 });
              await client.connect();
              const me = await client.getMe() as Api.User;
              if (me) {
                const accountId = me.id.toString();
                activeClients.set(accountId, client);
                accountOwners.set(accountId, userId);
                
                setupAccountHandlers(userId, client, me);
                await saveAccount(userId, accountId, sessionStr);
                
                const totalAccs = Array.from(accountOwners.entries()).filter(([_, owner]) => owner === userId).length;
                await logToLoggerBot(userId, `✅ **Account Added!**\n\n**Name:** \`${me.firstName}\`\n**ID:** \`${accountId}\`\n**Total Connected:** **${totalAccs} accounts**`);
                
                userStates.delete(userId);
                try {
                  await masterBot.editMessage(userId, { message: prog.id, text: `✅ **Account Connected: ${me.firstName}**`, buttons: [[Button.inline("🔙 Menu", Buffer.from("menu_start"))]] });
                } catch (err: any) {
                  if (err.errorMessage !== "MESSAGE_NOT_MODIFIED") throw err;
                }
              }
            } catch (e: any) {
               try {
                 await masterBot.editMessage(userId, { message: prog.id, text: `❌ **Error:** ${e.message}`, buttons: [[Button.inline("🔁 Try Again", Buffer.from("menu_add_account"))]] });
               } catch (err: any) {
                 if (err.errorMessage !== "MESSAGE_NOT_MODIFIED") throw err;
               }
            }
          }
          return;
        }

        if (state.step === "ad_create_msg") {
          const template = message.text;
          const userTemplates = templates.get(userId) || [];
          userTemplates.push(template);
          templates.set(userId, userTemplates);
          await saveUserData(userId);
          userStates.delete(userId);
          await masterBot.sendMessage(userId, { message: `✅ **Template Saved!**\n\n\`${template.slice(0, 50)}...\` \n\nYou can now use this to start broadcasts.`, buttons: [[Button.inline("🔙 Back", Buffer.from("menu_ad_menu"))]] });
          return;
        }

        if (state.step === "ar_config_rule") {
          const text = message.text || "";
          if (text.includes(":")) {
            const [key, val] = text.split(":").map(s => s.trim());
            const rules = autoReplyRules.get(userId) || new Map();
            rules.set(key.toLowerCase(), val);
            autoReplyRules.set(userId, rules);
            await saveUserData(userId);
            userStates.delete(userId);
            await masterBot.sendMessage(userId, { message: `✅ **Auto-Reply Rule Added!**\n\nIf user says: **${key}**\nBot replies: **${val}**`, buttons: [[Button.inline("🔙 Back", Buffer.from("menu_auto_reply"))]] });
          } else {
            await masterBot.sendMessage(userId, { message: "❌ Invalid format. Use `keyword: reply`" });
          }
          return;
        }

        if (state.step === "admin_ban_user") {
          const targetId = parseInt(message.text);
          if (!isNaN(targetId)) {
            bannedUsers.add(targetId);
            await saveUserData(targetId);
            userStates.delete(userId);
            // Notify user
            masterBot.sendMessage(targetId, { message: "Admin Banned You Please Contact Admin @NoPasswordNo" }).catch(() => {});
            await masterBot.sendMessage(userId, { message: `✅ User \`${targetId}\` banned.`, buttons: [[Button.inline("🔙 Admin Panel", Buffer.from("menu_admin"))]] });
          }
          return;
        }
        if (state.step === "admin_unban_user") {
          const targetId = parseInt(message.text);
          if (!isNaN(targetId)) {
            bannedUsers.delete(targetId);
            await saveUserData(targetId);
            userStates.delete(userId);
            // Notify user
            masterBot.sendMessage(targetId, { message: "You Are Successfully Unban From Our Bot" }).catch(() => {});
            await masterBot.sendMessage(userId, { message: `✅ User \`${targetId}\` unbanned.`, buttons: [[Button.inline("🔙 Admin Panel", Buffer.from("menu_admin"))]] });
          }
          return;
        }
        if (state.step === "admin_add_admin") {
          const targetId = parseInt(message.text);
          if (!isNaN(targetId)) {
            admins.add(targetId);
            await saveUserData(targetId);
            userStates.delete(userId);
            await masterBot.sendMessage(userId, { message: `✅ User \`${targetId}\` is now Admin.`, buttons: [[Button.inline("🔙 Admin Panel", Buffer.from("menu_admin"))]] });
          }
          return;
        }
        if (state.step === "admin_remove_admin") {
          const targetId = parseInt(message.text);
          if (!isNaN(targetId)) {
            admins.delete(targetId);
            await saveUserData(targetId);
            userStates.delete(userId);
            await masterBot.sendMessage(userId, { message: `✅ User \`${targetId}\` removed from Admins.`, buttons: [[Button.inline("🔙 Admin Panel", Buffer.from("menu_admin"))]] });
          }
          return;
        }
        if (state.step === "admin_vip_add_user") {
          const targetId = parseInt(message.text);
          if (!isNaN(targetId)) {
            brandingDisabled.add(targetId);
            await saveUserData(targetId);
            userStates.delete(userId);
            await masterBot.sendMessage(userId, { message: `✅ User \`${targetId}\` added to VIP Branding Bypass.`, buttons: [[Button.inline("🔙 Admin Panel", Buffer.from("menu_admin"))]] });
          }
          return;
        }
        if (state.step === "admin_vip_remove_user") {
          const targetId = parseInt(message.text);
          if (!isNaN(targetId)) {
            brandingDisabled.delete(targetId);
            await saveUserData(targetId);
            userStates.delete(userId);
            await masterBot.sendMessage(userId, { message: `❌ User \`${targetId}\` removed from VIP Branding Bypass.`, buttons: [[Button.inline("🔙 Admin Panel", Buffer.from("menu_admin"))]] });
          }
          return;
        }

        if (state.step === "awaiting_broadcast_msg") {
          const broadcastMsg = message.text;
          userStates.set(userId, { step: "awaiting_broadcast_interval", data: { ...state.data, broadcastMsg } });
          await masterBot.sendMessage(userId, { message: "⏱️ **Enter Interval (in minutes):**\n\nExample: 10" });
          return;
        }

        if (state.step === "awaiting_broadcast_interval") {
          const interval = parseInt(message.text);
          if (isNaN(interval) || interval < 1) {
            await masterBot.sendMessage(userId, { message: "❌ Invalid interval. Please enter a number (minutes)." });
            return;
          }
          const { sel, broadcastMsg } = state.data;
          const stats = getUserStats(userId);

          if (!stats.hasStartedLogger) {
              userStates.set(userId, { step: "verifying_logger", data: { sel, broadcastMsg, interval } });
              await masterBot.sendMessage(userId, {
                  message: `⚠️ **Logger Bot Required!**\n\nTo ensure transparency, you must start our logger bot to receive real-time logs of your broadcast.\n\n1️⃣ Click the button below to start the logger bot.\n2️⃣ Come back here and click "I Have Started The Logger Bot".`,
                  buttons: [
                      [Button.url("🤖 Start Logger Bot", `https://t.me/${loggerBotUsername}`)], 
                      [Button.inline("✅ I Have Started The Logger Bot", Buffer.from("verify_logger"))]
                  ]
              });
              return;
          }
          
          let startedCount = 0;
          for (const id of sel) {
            const started = await startCampaignForAccount(userId, id, broadcastMsg, interval);
            if (started) startedCount++;
          }
          
          userStates.delete(userId);
          userSelections.delete(userId);
          
          await masterBot.sendMessage(userId, { 
            message: `✅ **Broadcast Started Successfully!**\n\nReturning to Main Menu...`,
            buttons: getMainMenuButtons(userId, isAdminUser)
          });
          return;
        }
      }

      if (message.text && message.text.startsWith("/id")) {
        await masterBot.sendMessage(userId, { message: `🆔 **Your User ID:** \`${userId}\`` });
        return;
      }

      if (message.text && message.text.startsWith("/start")) {
        // Banned User Guard
        if (bannedUsers.has(userId)) {
          await masterBot.sendMessage(userId, { 
            message: `🚫 **You Are Banned From Our Bot**\n\nPlease Contact Support @NoPasswordNo`,
          });
          return;
        }

        // CAPTCHA Challenge (Skip if verified in last 24h)
        const stats = getUserStats(userId);
        if (invalidSessions.size > 0) {
            // Find if current user has an invalid session
            const userAccountIds = Array.from(accountOwners.entries())
                .filter(([accId, ownerId]) => ownerId === userId)
                .map(([accId]) => accId);
            
            const hasInvalid = userAccountIds.some(accId => invalidSessions.has(accId));
            if (hasInvalid) {
                await masterBot.sendMessage(userId, {
                    message: "⚠️ **Session Expired!**\n\nOne or more of your accounts have been disconnected or revoked by Telegram.\n\nPlease check your account list and reconnect them."
                }).catch(() => {});
            }
        }

        const lastCaptcha = stats.lastCaptchaTime || 0;
        const now = Date.now();
        const IS_24H_EXPIRED = (now - lastCaptcha > 24 * 60 * 60 * 1000);

        if (!IS_24H_EXPIRED || isAdminUser) {
            // Check mandatory membership directly
            const joined = await checkMandatory(userId);
            if (!joined && !isAdminUser) {
                const btns: any[] = MANDATORY_CHANNELS.map(c => [Button.url(c.name, c.url)]);
                btns.push([Button.inline("🔄 I Have Joined", Buffer.from("verify_join"))]);
                await masterBot.sendMessage(userId, { 
                    message: `⚠️ **Membership Required!**\n\nPlease join our mandatory channels to use the bot services:`, 
                    buttons: btns 
                });
                return;
            }

            // Show Main Menu
            await masterBot.sendMessage(userId, {
              message: `🚀 **Welcome to TeleMarketerPro Bot!**\n\nThe most professional ad management bot on Telegram.\n\nUse the buttons below to navigate:`,
              buttons: getMainMenuButtons(userId, isAdminUser)
            });
            return;
        }

        const num1 = Math.floor(Math.random() * 20) + 1;
        const num2 = Math.floor(Math.random() * 20) + 1;
        const sum = num1 + num2;
        captchaAnswers.set(userId, sum);
        userStates.set(userId, { step: "awaiting_captcha" });

        await masterBot.sendMessage(userId, {
            message: `🤖 **Human Verification**\n\nPlease solve this simple math problem to prove you are a human:\n\n**${num1} + ${num2} = ?**`,
        });
        return;
      }

      // Default Help / Fallback for anyone
      if (message.text && !message.text.startsWith("/")) {
          await masterBot.sendMessage(userId, { 
              message: `👋 **Hello!**\n\nI am the **TeleMarketerPro** system bot. Use me to manage your Telegram marketing campaigns.\n\nClick /start to see the main menu or use the dashboard to add your accounts.`,
              buttons: [[Button.inline("🚀 Get Started", Buffer.from("menu_start"))]]
          });
      }
    }, new NewMessage({}));

    masterBot.addEventHandler(async (event: any) => {
      const q = event;
      if (!q || (!q.data && !q.query)) return;
      
      const data = (q.data || (q.query && q.query.data))?.toString();
      const userId = Number(q.senderId || q.userId || (q.query && q.query.userId));
      const msgId = q.msgId || q.messageId || (q.query && q.query.msgId) || (q.message && q.message.id);
      const isAdminUser = admins.has(userId);

      const state = userStates.get(userId);
      if (state && state.step === "awaiting_captcha") {
        return event.answer({ message: "❌ Please solve the CAPTCHA first!", alert: true });
      }

      if (bannedUsers.has(userId)) return;

      const safeEdit = async (params: any) => {
        try {
          if (!params.message) params.message = msgId;
          if (!params.message) return;
          
          // Timeout for edits to prevent hanging UI during high load or flood
          await Promise.race([
            masterBot.editMessage(userId, params),
            new Promise((_, rej) => setTimeout(() => rej(new Error("Edit Timeout")), 4500))
          ]);
        } catch (e: any) {
          if (e.errorMessage === "MESSAGE_NOT_MODIFIED" || e.message === "Edit Timeout") return;
          console.error("Edit error:", e.message);
        }
      };

      // Use a more robust check for mandatory membership
      const needsMandatoryCheck = !isAdminUser && data !== "menu_about" && data !== "noop" && data !== "verify_join";
      
      try {
        if (needsMandatoryCheck) {
            const joined = await checkMandatory(userId);
            if (!joined) {
                const btns: any[] = MANDATORY_CHANNELS.map(c => [Button.url(c.name, c.url)]);
                btns.push([Button.inline("🔄 I Have Joined", Buffer.from("verify_join"))]);
                return safeEdit({ 
                    text: `⚠️ **Membership Required!**\n\nPlease join our mandatory channels to use the bot services:`, 
                    buttons: btns 
                });
            }
        }

        if (data === "verify_join") {
            const joined = await checkMandatory(userId, true);
            if (joined) {
                await event.answer({ message: "✅ Successfully verified membership!", alert: true });
                await safeEdit({ text: `🚀 **Main Menu**\n\nUse buttons to navigate:`, buttons: getMainMenuButtons(userId, isAdminUser) });
            } else {
                await event.answer({ message: "❌ You have not joined all channels yet!", alert: true });
            }
            return;
        }
        

        if (data === "menu_start") {
          userStates.delete(userId);
          checkAllAccountsBranding(userId); // Background check for instant feedback
          await safeEdit({ message: q.msgId, text: `🚀 **Main Menu**\n\nUse buttons to navigate:`, buttons: getMainMenuButtons(userId, isAdminUser) });
        } else if (data === "verify_logger") {
            const stats = getUserStats(userId);
            if (stats.hasStartedLogger) {
                const state = userStates.get(userId);
                if (state && state.step === "verifying_logger") {
                    const { sel, broadcastMsg, interval } = state.data;
                    let startedCount = 0;
                    for (const id of sel) {
                        const started = await startCampaignForAccount(userId, id, broadcastMsg, interval);
                        if (started) startedCount++;
                    }
                    userStates.delete(userId);
                    userSelections.delete(userId);
                    const brandingNote = !brandingDisabled.has(userId) ? "\n\n⚠️ **Note:** Mandatory branding @TeleMarketerProNews will be appended to your messages." : "";
                    
                    await event.answer({ message: "✅ Broadcast Started Successfully!", alert: true });
                    await safeEdit({ 
                        text: `🚀 **Main Menu**\n\nUse buttons to navigate:`, 
                        buttons: getMainMenuButtons(userId, isAdminUser) 
                    });
                } else {
                    await event.answer({ message: "✅ Logger Bot Verified! Returning to menu...", alert: false });
                    await safeEdit({ text: `🚀 **Main Menu**`, buttons: getMainMenuButtons(userId, isAdminUser) });
                }
            } else {
                await event.answer({ message: "❌ You have not started the logger bot please start it then click on i have started the logger bot", alert: true });
            }
        } else if (data === "menu_admin") {
          userStates.delete(userId);
          if (!isAdminUser) return event.answer({ message: "❌ Unauthorized! Admin access only.", alert: true });
          
          await event.answer({ message: "🔄 Stats Refreshed Successfully!", alert: false });

          // Calculate Real-time Stats
          const totalUsers = userStatsTracker.size;
          const totalAccounts = activeClients.size;
          const totalJobs = activeJobs.size;
          
          const globalStats = Array.from(userStatsTracker.values()).reduce((acc, user) => {
              return {
                  sent: acc.sent + (user.totalSent || 0),
                  groups: acc.groups + (user.totalGroups || 0)
              };
          }, { sent: 0, groups: 0 });

          await safeEdit({ 
            message: q.msgId, 
            text: `👑 **Admin Control Center** (Real-time)\n\n` +
                  `👤 **Total Users:** \`${totalUsers}\`\n` +
                  `📱 **Connected Accounts:** \`${totalAccounts}\`\n` +
                  `🔄 **Active Campaigns:** \`${totalJobs}\`\n\n` +
                  `📊 **Bot Reach Statistics:**\n` +
                  `📤 **Total Messages Sent:** \`${globalStats.sent}\`\n` +
                  `📡 **Total Groups Reached:** \`${globalStats.groups}\` groups\n\n` +
                  `🔒 **Security & Settings:**\n` +
                  `🚫 **Banned:** \`${bannedUsers.size}\` | 🛡️ **Admins:** \`${admins.size}\` | 🌟 **VIPs:** \`${brandingDisabled.size}\``, 
            buttons: [
              [Button.inline("📊 Refresh Stats", Buffer.from("menu_admin"))],
              [Button.inline("🚫 Ban User", Buffer.from("admin_ban")), Button.inline("✅ Unban User", Buffer.from("admin_unban"))],
              [Button.inline("🛡️ Add Admin", Buffer.from("admin_add")), Button.inline("🛡️ Remove Admin", Buffer.from("admin_remove"))],
              [Button.inline("🌟 Add VIP (No Brand)", Buffer.from("admin_vip_add")), Button.inline("❌ Remove VIP", Buffer.from("admin_vip_remove"))],
              [Button.inline("🔙 Back", Buffer.from("menu_start"))]
            ] 
          });
        } else if (data === "menu_add_account") {
          userStates.set(userId, { step: "awaiting_session" });
          await safeEdit({ message: q.msgId, text: `➕ **Add Account**\n\nPaste session string or upload .txt file.\n\nGenerator: https://tele-session-generator-blue.vercel.app/`, buttons: [[Button.inline("🔙 Cancel", Buffer.from("menu_start"))]] });
        } else if (data === "menu_my_accounts") {
          const allAccounts = Array.from(activeClients.keys());
          const accounts = allAccounts.filter(id => {
              const owner = accountOwners.get(id);
              // console.log(`Account ${id} owner: ${owner} | Calling User: ${userId}`);
              return owner === userId;
          });
          let msg = `📊 **My Accounts (${accounts.length})**\n\n`;
          const btns = [];
          
          if (accounts.length === 0) {
            msg += "_No accounts connected._";
          } else {
            for (const acc of accounts) {
              const isInvalid = invalidSessions.has(acc);
              const label = `${isInvalid ? "❌ [EXPIRED] " : "👤 "}${acc.slice(0, 8)}...`;
              btns.push([
                Button.inline(label, Buffer.from("noop")),
                Button.inline("🗑️ Delete", Buffer.from(`del_acc_${acc}`))
              ]);
            }
            btns.push([Button.inline("🗑️ Delete All Accounts", Buffer.from("del_acc_all"))]);
          }
          btns.push([Button.inline("🔙 Back", Buffer.from("menu_start"))]);
          await safeEdit({ message: q.msgId, text: msg, buttons: btns });
        } else if (data.startsWith("del_acc_")) {
          const accId = data.replace("del_acc_", "");
          if (accId === "all") {
             const userAccs = Array.from(activeClients.keys()).filter(id => accountOwners.get(id) === userId);
             for (const id of userAccs) {
                 const client = activeClients.get(id);
                 if (client) await client.disconnect();
                 activeClients.delete(id);
                 accountOwners.delete(id);
                 activeJobs.get(id)?.stop();
                 activeJobs.delete(id);
                 await removeAccountFromDb(userId, id);
             }
             await event.answer({ message: "🗑️ All your accounts deleted!", alert: true });
          } else {
             const client = activeClients.get(accId);
             if (client) {
               await client.disconnect();
               activeClients.delete(accId);
               accountOwners.delete(accId);
               activeJobs.get(accId)?.stop();
               activeJobs.delete(accId);
               await removeAccountFromDb(userId, accId);
               await event.answer({ message: `🗑️ Account deleted successfully!`, alert: true });
             } else {
               // Fallback if client not active but exists in DB
               await removeAccountFromDb(userId, accId);
               accountOwners.delete(accId);
               await event.answer({ message: `🗑️ Account record removed.`, alert: true });
             }
          }
          // Refresh
          const allAccs = Array.from(activeClients.keys());
          const accounts = allAccs.filter(id => accountOwners.get(id) === userId);
          let msg = `📊 **My Accounts (${accounts.length})**\n\n`;
          const btns = [];
          if (accounts.length === 0) msg += "_No accounts connected._";
          else {
            for (const acc of accounts) btns.push([Button.inline(`👤 ${acc.slice(0, 8)}...`, Buffer.from("noop")), Button.inline("🗑️ Delete", Buffer.from(`del_acc_${acc}`))]);
            btns.push([Button.inline("🗑️ Delete All Accounts", Buffer.from("del_acc_all"))]);
          }
          btns.push([Button.inline("🔙 Back", Buffer.from("menu_start"))]);
          await safeEdit({ message: q.msgId, text: msg, buttons: btns });
        } else if (data === "menu_dashboard") {
          const stats = getUserStats(userId);
          const myAccsCount = Array.from(activeClients.keys()).filter(id => accountOwners.get(id) === userId).length;
          const myJobsCount = Array.from(activeJobs.keys()).filter(id => accountOwners.get(id) === userId).length;
          const msg = `📈 **User Dashboard**\n\n` +
                      `🆔 **User ID:** \`${userId}\`\n` +
                      `👤 **Connected Accounts:** \`${myAccsCount}\`\n` +
                      `🚀 **Active Campaigns:** \`${myJobsCount}\`\n` +
                      `📤 **Total Messages Sent:** \`${stats.totalSent}\`\n` +
                      `📡 **Groups/Channels Reached:** \`${stats.totalGroups}\`\n\n` +
                      `📢 **System Logs:** ${logs.length} entries`;
          await safeEdit({ message: q.msgId, text: msg, buttons: [[Button.inline("🔙 Back", Buffer.from("menu_start"))]] });
        } else if (data === "menu_ad_menu") {
          const userTemplates = templates.get(userId) || [];
          await safeEdit({ 
            message: q.msgId, 
            text: `📣 **Ad Management Menu**\n\nTemplates Saved: **${userTemplates.length}**\n\nManage your ad messages and templates below:`, 
            buttons: [
              [Button.inline("➕ Create New Template", Buffer.from("ad_create"))],
              [Button.inline("📂 View My Templates", Buffer.from("ad_list"))],
              [Button.inline("🔙 Back to Main", Buffer.from("menu_start"))]
            ] 
          });
        } else if (data === "menu_auto_reply") {
          const rules = autoReplyRules.get(userId) || new Map();
          const isEnabled = autoReplyEnabled.has(userId);
          await safeEdit({ 
            message: q.msgId, 
            text: `🤖 **Auto Reply System**\n\nStatus: ${isEnabled ? "✅ **Active**" : "❌ **Disabled**"}\nRules Configured: **${rules.size}**\n\nAutomatically reply to keywords detected in groups or PMs.`, 
            buttons: [
              [Button.inline("⚙️ Configure Rules", Buffer.from("ar_config"))],
              [Button.inline(isEnabled ? "🔴 Disable System" : "🟢 Enable System", Buffer.from("ar_toggle"))],
              [Button.inline("🔙 Back to Main", Buffer.from("menu_start"))]
            ] 
          });
        } else if (data === "ad_create") {
          await safeEdit({ message: q.msgId, text: `📝 **Create Ad Template**\n\nSend the message you want to save as a template.`, buttons: [[Button.inline("🔙 Back", Buffer.from("menu_ad_menu"))]] });
          userStates.set(userId, { step: "ad_create_msg" });
        } else if (data === "ad_list") {
          const userTemplates = templates.get(userId) || [];
          let msg = `📂 **Your Templates:**\n\n`;
          if (userTemplates.length === 0) msg += "_No templates found._";
          else userTemplates.forEach((t, i) => msg += `${i + 1}. \`${t.slice(0, 30)}...\`\n`);
          await safeEdit({ message: q.msgId, text: msg, buttons: [[Button.inline("➕ Create New", Buffer.from("ad_create"))], [Button.inline("🔙 Back", Buffer.from("menu_ad_menu"))]] });
        } else if (data === "ar_config") {
          const rules = autoReplyRules.get(userId) || new Map();
          let msg = `🤖 **Auto Reply Message Config**\n\n` +
                    `A **Keyword** is the word or sentence that triggers a reply.\n\n` +
                    `⚙️ **Active Rules:**\n`;
          if (rules.size === 0) msg += "_No rules configured._";
          else Array.from(rules.entries()).forEach(([k, v]) => msg += `• **${k}** → ${v}\n`);
          msg += `\n**To set a new reply message, send:**\n\`keyword: your reply\``;
          await safeEdit({ message: q.msgId, text: msg, buttons: [[Button.inline("🔙 Back", Buffer.from("menu_auto_reply"))]] });
          userStates.set(userId, { step: "ar_config_rule" });
        } else if (data === "ar_toggle") {
          if (autoReplyEnabled.has(userId)) autoReplyEnabled.delete(userId);
          else autoReplyEnabled.add(userId);
          await saveUserData(userId);
          const isEnabled = autoReplyEnabled.has(userId);
          await event.answer({ message: `Auto Reply is now ${isEnabled ? "ENABLED ✅" : "DISABLED ❌"}`, alert: true });
          await safeEdit({ 
            message: q.msgId, 
            text: `🤖 **Auto Reply Settings**\nStatus: ${isEnabled ? "✅ Enabled" : "❌ Disabled"}`, 
            buttons: [
              [Button.inline("⚙️ Configure Rules", Buffer.from("ar_config"))],
              [Button.inline(isEnabled ? "❌ Disable" : "✅ Enable", Buffer.from("ar_toggle"))],
              [Button.inline("🔙 Back", Buffer.from("menu_start"))]
            ]
          });
        } else if (data === "menu_about") {
          await safeEdit({ message: q.msgId, text: `ℹ️ **About TeleMarketerPro**\n\nThe most professional Telegram Ad Tool. Built for speed and reliability.\n\n**Developed By:** @NoPasswordNo\n**Updates/News:** @TeleMarketerProNews`, buttons: [[Button.inline("🔙 Back", Buffer.from("menu_start"))]] });
        } else if (data === "menu_broadcast") {
          const userAccs = Array.from(accountOwners.entries()).filter(([_, owner]) => owner === userId).map(([id]) => id);
          if (userAccs.length === 0) return event.answer({ message: "❌ No accounts connected! Add an account first.", alert: true });
          
          const isAnyBroadcasting = userAccs.some(id => activeJobs.has(id));
          if (isAnyBroadcasting) {
              // Show Stop Confirmation or Menu
              await safeEdit({
                  text: `⚠️ **Active Campaigns Detected**\n\nWould you like to stop all currently running broadcasts?`,
                  buttons: [
                      [Button.inline("🛑 Stop All Broadcasts", Buffer.from("stop_sel_all"))],
                      [Button.inline("🔙 Back", Buffer.from("menu_start"))]
                  ]
              });
              return;
          }

          const sel = userSelections.get(userId) || new Set();
          const btns = getBroadcastAccountButtons(userId, sel);
          
          btns.push([Button.inline("🌟 Select All", Buffer.from("sel_all")), Button.inline("🚫 Clear", Buffer.from("desel_all"))]);
          btns.push([Button.inline("✅ Done", Buffer.from("start_sel"))]);
          btns.push([Button.inline("🔙 Back", Buffer.from("menu_start"))]);
          
          await safeEdit({ 
            message: q.msgId, 
            text: `🎯 **Broadcast Center**\n\n🔘 = Idle | ✅ = Selected\n\nSelect accounts for broadcast:`, 
            buttons: btns 
          });
        } else if (data.startsWith("toggle_")) {
          const id = data.replace("toggle_", "");
          if (invalidSessions.has(id)) {
              return event.answer({ message: "❌ This account session has expired. Please delete and relogin.", alert: true });
          }
          const sel = userSelections.get(userId) || new Set();
          if (sel.has(id)) sel.delete(id); else sel.add(id);
          userSelections.set(userId, sel);
          
          const userAccsCount = Array.from(accountOwners.entries()).filter(([_, owner]) => owner === userId).length;
          const btns = getBroadcastAccountButtons(userId, sel);
          
          btns.push([Button.inline("🌟 Select All", Buffer.from("sel_all")), Button.inline("🚫 Clear", Buffer.from("desel_all"))]);
          btns.push([Button.inline("✅ Done", Buffer.from("start_sel"))]);
          btns.push([Button.inline("🔙 Back", Buffer.from("menu_start"))]);
          
          await safeEdit({ 
            message: q.msgId, 
            text: `🎯 **Broadcast Center**\n\nSelected: **${sel.size}** / ${userAccsCount}\n\nSelect accounts for broadcast:`, 
            buttons: btns 
          });
        } else if (data === "sel_all") {
          const userAccs = Array.from(accountOwners.entries()).filter(([_, owner]) => owner === userId).map(([id]) => id);
          const validAccs = userAccs.filter(id => !invalidSessions.has(id));
          const all = new Set(validAccs);
          userSelections.set(userId, all);
          
          const btns = getBroadcastAccountButtons(userId, all);
          btns.push([Button.inline("🚫 Clear", Buffer.from("desel_all"))]);
          btns.push([Button.inline("✅ Done", Buffer.from("start_sel"))]);
          btns.push([Button.inline("🔙 Back", Buffer.from("menu_start"))]);
          await safeEdit({ message: q.msgId, text: `🎯 **All Valid Accounts Selected!**`, buttons: btns });
        } else if (data === "desel_all") {
          userSelections.delete(userId);
          const emptySel = new Set<string>();
          const btns = getBroadcastAccountButtons(userId, emptySel);
          btns.push([Button.inline("🌟 Select All", Buffer.from("sel_all"))]);
          btns.push([Button.inline("✅ Done", Buffer.from("start_sel"))]);
          btns.push([Button.inline("🔙 Back", Buffer.from("menu_start"))]);
          await safeEdit({ message: q.msgId, text: `🎯 **Selection Cleared!**`, buttons: btns });
        } else if (data === "stop_sel_all") {
            const userAccs = Array.from(accountOwners.entries()).filter(([_, owner]) => owner === userId).map(([id]) => id);
            let stopped = 0;
            for (const id of userAccs) {
                if (activeJobs.has(id)) {
                    activeJobs.get(id)?.stop();
                    activeJobs.delete(id);
                    stopped++;
                }
            }
            await event.answer({ message: `🛑 Stopped ${stopped} broadcasts!`, alert: true });
            await safeEdit({ message: q.msgId, text: `🚀 **Main Menu**\n\nUse buttons to navigate:`, buttons: getMainMenuButtons(userId, isAdminUser) });
        } else if (data === "start_sel") {
          const sel = userSelections.get(userId);
          if (!sel || !sel.size) return event.answer({ message: "Select accounts first!", alert: true });
          
          const userTemplates = templates.get(userId) || [];
          if (userTemplates.length === 0) {
              return event.answer({ message: "❌ No templates found! Please create one in Ad Menu first.", alert: true });
          }
          
          const btns = [];
          userTemplates.forEach((t, i) => {
              btns.push([Button.inline(`📄 Template ${i+1}: ${t.slice(0, 20)}...`, Buffer.from(`pick_temp_${i}`))]);
          });
          btns.push([Button.inline("🔙 Back", Buffer.from("menu_broadcast"))]);
          
          await safeEdit({ 
              message: q.msgId, 
              text: `📂 **Select Ad Template:**\n\nChoose the advertisement message to broadcast:`, 
              buttons: btns 
          });
        } else if (data.startsWith("pick_temp_")) {
           const idx = parseInt(data.replace("pick_temp_", ""));
           const userTemplates = templates.get(userId) || [];
           const template = userTemplates[idx];
           const sel = userSelections.get(userId);
           
           userStates.set(userId, { step: "awaiting_broadcast_interval", data: { sel, broadcastMsg: template } });
           await safeEdit({ 
               message: q.msgId, 
               text: `🕒 **Set Posting Interval**\n\nSelected Template: \`${template.slice(0, 30)}...\`\n\nEnter interval in minutes (e.g., 10):`, 
               buttons: [[Button.inline("🔙 Back", Buffer.from("start_sel"))]] 
           });
        } else if (data === "stop_sel") {
            const sel = userSelections.get(userId);
            if (!sel || !sel.size) return event.answer({ message: "Select accounts to stop!", alert: true });
            
            let stoppedCount = 0;
            for (const id of sel) {
                if (activeJobs.has(id)) {
                    activeJobs.get(id)?.stop();
                    activeJobs.delete(id);
                    stoppedCount++;
                    await logToLoggerBot(userId, `🛑 **Campaign Stopped!**\nAccount: \`${id.slice(0,8)}...\``);
                }
            }
            await event.answer({ message: "🛑 Selected campaigns stopped successfully!", alert: true });
            
            userSelections.delete(userId);
            await safeEdit({ message: q.msgId, text: `🛑 **Stopped ${stoppedCount} campaigns.**\n\nAll selected tasks have been halted.`, buttons: [[Button.inline("🔙 Menu", Buffer.from("menu_start"))]] });
        } else if (data === "admin_ban" && isAdminUser) {
          userStates.set(userId, { step: "admin_ban_user" });
          await safeEdit({ message: q.msgId, text: "🆔 **Enter User ID to ban:**", buttons: [[Button.inline("🔙 Cancel", Buffer.from("menu_admin"))]] });
        } else if (data === "admin_unban" && isAdminUser) {
          userStates.set(userId, { step: "admin_unban_user" });
          await safeEdit({ message: q.msgId, text: "🆔 **Enter User ID to unban:**", buttons: [[Button.inline("🔙 Cancel", Buffer.from("menu_admin"))]] });
        } else if (data === "admin_add" && isAdminUser) {
          userStates.set(userId, { step: "admin_add_admin" });
          await safeEdit({ message: q.msgId, text: "🆔 **Enter User ID to make Admin:**", buttons: [[Button.inline("🔙 Cancel", Buffer.from("menu_admin"))]] });
        } else if (data === "admin_remove" && isAdminUser) {
          userStates.set(userId, { step: "admin_remove_admin" });
          await safeEdit({ message: q.msgId, text: "🛡️ **Enter User ID to REMOVE from Admin Panel:**", buttons: [[Button.inline("🔙 Cancel", Buffer.from("menu_admin"))]] });
        } else if (data === "admin_vip_add" && isAdminUser) {
          userStates.set(userId, { step: "admin_vip_add_user" });
          await safeEdit({ message: q.msgId, text: "🌟 **Enter User ID to ADD to VIPs (Branding Removed):**", buttons: [[Button.inline("🔙 Cancel", Buffer.from("menu_admin"))]] });
        } else if (data === "admin_vip_remove" && isAdminUser) {
          userStates.set(userId, { step: "admin_vip_remove_user" });
          await safeEdit({ message: q.msgId, text: "❌ **Enter User ID to REMOVE from VIPs:**", buttons: [[Button.inline("🔙 Cancel", Buffer.from("menu_admin"))]] });
        }
      } catch (err) {
        console.error("Callback error:", err);
      }
    }, new CallbackQuery({}));
}

const app = express();
app.use(cors()); 
app.use(bodyParser.json());

// Request logging for debug
app.use((req, res, next) => {
  if (req.url.startsWith("/api/")) {
    console.log(`[API REC] ${req.method} ${req.url}`);
  }
  next();
});

app.get("/api/health", (req, res) => {
  console.log("[API] Health check");
  res.json({ status: "ok" });
});

app.get("/api/logs", (req, res) => {
  try {
    console.log(`[API] Serving ${logs.length} logs`);
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(JSON.stringify(logs));
  } catch (err) {
    console.error("API Logs Error:", err);
    res.status(500).json({ error: "Failed to fetch logs", details: err instanceof Error ? err.message : String(err) });
  }
});

// --- Auth & Admin Web API ---

app.post("/api/login", (req, res) => {
  try {
    const { key } = req.body;
    console.log(`[AUTH] Login attempt with key: "${key}"`);
    
    if (!key) return res.status(400).json({ error: "Key required" });

    const keyData = licenseKeys.get(key.trim());
    
    if (!keyData) {
      console.log(`[AUTH] Key not found in map. Total keys: ${licenseKeys.size}`);
      return res.status(401).json({ error: "Invalid License Key" });
    }

    const now = new Date();
    if (new Date(keyData.expiry) < now) {
      console.log(`[AUTH] Key expired: ${keyData.expiry}`);
      return res.status(403).json({ error: "Key expired" });
    }

    console.log(`[AUTH] Success: ${key}`);
    res.json({ success: true, expiry: keyData.expiry });
  } catch (err) {
    console.error("[AUTH] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/admin-login", (req, res) => {
  const { username, password } = req.body;
  
  // Master Credentials
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true, isAdmin: true });
  }

  // Dynamic Admin Check
  const idNum = Number(username);
  if (!isNaN(idNum) && password === ADMIN_PASS && admins.has(idNum)) {
    console.log(`[AUTH] Admin login successful via ID: ${idNum}`);
    return res.json({ success: true, isAdmin: true });
  }

  res.status(401).json({ error: "Invalid Admin Credentials" });
});

app.post("/api/keys/generate", async (req, res) => {
  const { months, adminId } = req.body;
  // Simple check for now (in production, verify admin session)
  const key = `TMP-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + (months || 1));
  
  licenseKeys.set(key, { userId: null, expiry: expiry.toISOString() });
  
  if (supabase) {
    await supabase.from("license_keys").insert({
      key,
      expiry: expiry.toISOString(),
      created_at: new Date().toISOString()
    });
  }

  addLog(`Generated Key: ${key} (Valid for ${months}m)`, 'info');
  res.json({ key, expiry: expiry.toISOString() });
});

app.get("/api/keys", (req, res) => {
  res.json(Array.from(licenseKeys.entries()).map(([k, v]) => ({ key: k, ...v })));
});

app.post("/api/admin/add", (req, res) => {
  const { targetId } = req.body;
  admins.add(Number(targetId));
  saveUserData(Number(targetId));
  res.json({ success: true });
});

app.post("/api/admin/remove", (req, res) => {
  const { targetId } = req.body;
  if (!targetId) return res.status(400).json({ error: "No user specified" });
  
  const idNum = Number(targetId);
  admins.delete(idNum);
  saveUserData(idNum);
  
  console.log(`[AUTH] Admin privileges revoked for: ${idNum}`);
  res.json({ success: true, removed: idNum });
});

app.post("/api/user/ban", (req, res) => {
  const { targetId } = req.body;
  const idNum = Number(targetId);
  bannedUsers.add(idNum);
  saveUserData(idNum);
  // Notify user
  masterBot.sendMessage(idNum, { message: "Admin Banned You Please Contact Admin @NoPasswordNo" }).catch(() => {});
  res.json({ success: true });
});

app.post("/api/user/unban", (req, res) => {
  const { targetId } = req.body;
  const idNum = Number(targetId);
  bannedUsers.delete(idNum);
  saveUserData(idNum);
  // Notify user
  masterBot.sendMessage(idNum, { message: "You Are Successfully Unban From Our Bot" }).catch(() => {});
  res.json({ success: true });
});

app.post("/api/admin/branding", (req, res) => {
  const { targetId } = req.body;
  const idNum = Number(targetId);
  if (brandingDisabled.has(idNum)) brandingDisabled.delete(idNum);
  else brandingDisabled.add(idNum);
  saveUserData(idNum);
  res.json({ success: true, isExempt: brandingDisabled.has(idNum) });
});

app.get("/api/admin/special-users", (req, res) => {
  res.json({
    admins: Array.from(admins),
    banned: Array.from(bannedUsers),
    brandingDisabled: Array.from(brandingDisabled)
  });
});

app.get("/api/accounts", async (req, res) => {
  if (isDataLoading && activeClients.size === 0) {
      return res.json({ loading: true });
  }
  const accountsData = [];
  for (const [id, client] of activeClients.entries()) {
    try {
      const me = await client.getMe().catch(() => null) as Api.User | null;
      if (me) {
          accountsData.push({
            id,
            firstName: me.firstName || "User",
            username: me.username || "",
            isCampaignRunning: activeJobs.has(id)
          });
      }
    } catch (e) {}
  }
  res.json(accountsData);
});

app.post("/api/accounts/add", async (req, res) => {
  const { sessionString } = req.body;
  if (!sessionString) return res.status(400).json({ error: "Session required" });
  
  try {
    const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    const me = await client.getMe() as Api.User;
    if (me) {
      const accountId = me.id.toString();
      activeClients.set(accountId, client);
      setupAccountHandlers(0, client, me); // Default to user 0 for now
      await saveAccount(0, accountId, sessionString);
      
      res.json({ 
        account: {
          id: accountId,
          firstName: me.firstName || "User",
          username: me.username || "",
          isCampaignRunning: false
        }
      });
    } else throw new Error("Could not get user info");
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/accounts/delete", async (req, res) => {
  const { accountId } = req.body;
  if (!accountId) return res.status(400).json({ error: "No account specified" });
  
  try {
    const client = activeClients.get(accountId);
    if (client) {
      await client.disconnect();
      activeClients.delete(accountId);
    }
    
    if (activeJobs.has(accountId)) {
      activeJobs.get(accountId)?.stop();
      activeJobs.delete(accountId);
    }
    
    await removeAccountFromDb(0, accountId); 
    
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/campaign/start", async (req, res) => {
  const { userId, accountId, message, interval } = req.body;
  if (!accountId || !message || !interval) {
    return res.status(400).json({ error: "Missing campaign data" });
  }

  const success = await startCampaignForAccount(userId || 0, accountId, message, interval);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: "Could not start campaign" });
  }
});

app.post("/api/campaign/stop", (req, res) => {
  const { accountId } = req.body;
  console.log(`[CAMPAIGN] Stop request for account: ${accountId}`);
  if (activeJobs.has(accountId)) {
    activeJobs.get(accountId)?.stop();
    activeJobs.delete(accountId);
    addLog(`CAMPAIGN_STOPPED: Node ${accountId.slice(0,6)} halted.`, 'info');
    res.json({ success: true });
  } else {
    res.json({ success: true, message: "No active job found, but confirmed stopped." });
  }
});

app.post("/api/check-membership", async (req, res) => {
  res.json({ joined: true }); // Bypass for web app login for now
});

// Catch-all for API routes to prevent fallthrough to SPA handler
app.all("/api/*", (req, res) => {
    console.warn(`[API 404] ${req.method} ${req.url}`);
    res.status(404).json({ error: "API route not found" });
});

initMasterBot();

// Periodic Branding Check (Controlled recursive loop to avoid overlapping)
async function monitorSessions() {
    try {
        const clients = Array.from(activeClients.entries());
        for (const [accountId, client] of clients) {
            const userId = accountOwners.get(accountId);
            if (!userId) continue;

            if (!client.connected) {
                try {
                    await client.connect();
                } catch (e) {
                    invalidSessions.add(accountId);
                    continue;
                }
            }

            try {
                const me = await client.getMe().catch(() => null) as Api.User | null;
                if (!me) {
                    if (!invalidSessions.has(accountId)) {
                        invalidSessions.add(accountId);
                        await logToLoggerBot(userId, `⚠️ **Session Expired / Revoked!**\n\n**Account:** \`${accountId}\`\n**Status:** Logged Out ❌\n\nPlease delete this account and re-login to continue broadcasting.`);
                    }
                    activeClients.delete(accountId);
                } else {
                    invalidSessions.delete(accountId);
                }
            } catch (e: any) {
                if (!invalidSessions.has(accountId)) {
                    invalidSessions.add(accountId);
                    await logToLoggerBot(userId, `⚠️ **Session Error!**\n\n**Account:** \`${accountId}\`\n**Reason:** \`${e.message}\`\n\nPlease check this account.`);
                }
            }
        }
    } catch (e) {
        console.error("Session Monitor Error:", e);
    }
    setTimeout(monitorSessions, 300000); // Check sessions every 5 minutes
}
monitorSessions();

// Periodic Branding Check (Controlled recursive loop to avoid overlapping)
async function startBrandingChecks() {
    try {
        const clients = Array.from(activeClients.entries());
        for (const [accountId, client] of clients) {
            const userId = accountOwners.get(accountId);
            // Verify client is connected and userId exists
            if (userId && !bannedUsers.has(userId) && client.connected) {
                await enforceProfileBranding(userId, accountId, client).catch(() => null);
            }
        }
    } catch (e) {
        console.error("Branding Check Loop Error:", e);
    }
    // Repeat after 5 seconds of idle time
    setTimeout(startBrandingChecks, 5000);
}
startBrandingChecks();

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }
  app.listen(PORT, "0.0.0.0", () => console.log(`Server: http://localhost:${PORT}`));
}

startServer();
