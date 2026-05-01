/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { 
  Users, 
  Send, 
  Settings, 
  Activity, 
  ExternalLink, 
  Info,
  ShieldCheck,
  LayoutDashboard,
  LogOut,
  Shield
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import AccountManager from "./components/AccountManager";
import LoginPage from "./components/LoginPage";
import AdminPanel from "./components/AdminPanel";

const MANDATORY_CHANNELS = [
  { name: "TeleMarketer Pro Chats", url: "https://t.me/TeleMarketerProChatss" },
  { name: "TeleMarketer Pro News", url: "https://t.me/TeleMarketerProNews" },
  { name: "Smart Keys Daily", url: "https://t.me/smartkeysdailyofficial" }
];

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);
  const [checking, setChecking] = useState(true);
  const [activeTab, setActiveTab] = useState<"dashboard" | "accounts" | "campaigns" | "logs" | "admin">("dashboard");

  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    // Check local storage for existing session
    const adminSess = localStorage.getItem("tm_admin_session");
    
    if (adminSess === "true") {
      setIsLoggedIn(true);
      setIsAdmin(true);
      setHasJoined(true);
      setChecking(false);
    } else {
      setChecking(false);
    }
  }, []);

  const handleLogin = async (data: { isAdmin?: boolean }) => {
    if (data.isAdmin) {
      setIsLoggedIn(true);
      setIsAdmin(true);
      setHasJoined(true);
      localStorage.setItem("tm_admin_session", "true");
      return;
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("tm_admin_session");
    setIsLoggedIn(false);
    setIsAdmin(false);
    window.location.reload();
  };

  const checkMembership = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/check-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "mock_user" })
      });
      const data = await res.json();
      if (data.joined) setHasJoined(true);
    } catch (err) {
      console.error("Check membership error:", err);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/logs");
        if (!res.ok) {
          throw new Error(`Server returned ${res.status} ${res.statusText}`);
        }
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await res.text();
          console.group("Non-JSON API Response");
          console.error("URL: /api/logs");
          console.error("Status:", res.status);
          console.error("Content-Type:", contentType);
          console.error("Body preview:", text.slice(0, 200));
          console.groupEnd();
          throw new Error("Expected JSON response but received HTML or other format. Check server logs.");
        }
        const data = await res.json();
        if (Array.isArray(data)) {
          setLogs(data);
        }
      } catch (err) {
        console.error("Log fetch error:", err);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  if (checking) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-bg-dark">
        <Activity className="animate-spin text-brand w-10 h-10" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (!hasJoined) {
    return (
      <div className="h-screen bg-bg-dark flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full card border-brand/20 bg-brand/5 backdrop-blur-sm"
        >
          <div className="flex items-center gap-3 mb-6">
            <ShieldCheck className="text-brand w-8 h-8" />
            <h2 className="text-2xl font-bold">Access Verification</h2>
          </div>
          
          <p className="text-gray-400 mb-6 text-sm">
            To use TeleMarketer Pro, you must be a member of our official channels.
            Please join all of them to continue.
          </p>

          <div className="space-y-3 mb-8">
            {MANDATORY_CHANNELS.map((ch, i) => (
              <a 
                key={i} 
                href={ch.url} 
                target="_blank" 
                rel="noreferrer"
                className="flex items-center justify-between p-3 bg-black border border-line rounded hover:border-brand/40 transition-all group"
              >
                <span className="text-sm font-medium">{ch.name}</span>
                <ExternalLink className="w-4 h-4 text-gray-500 group-hover:text-brand" />
              </a>
            ))}
          </div>

          <button 
            onClick={checkMembership}
            className="w-full btn-primary"
          >
            I have joined all channels
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-dark flex">
      {/* Sidebar */}
      <aside className="w-72 bg-bg-dark border-r border-white/5 hidden md:flex flex-col">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-2xl bg-brand/20 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.2)]">
              <Send className="text-brand w-6 h-6" />
            </div>
            <span className="text-2xl font-black tracking-tighter text-white">TM PRO</span>
          </div>

          <nav className="space-y-1.5">
            <NavItem 
              active={activeTab === "dashboard"} 
              onClick={() => setActiveTab("dashboard")}
              icon={<LayoutDashboard className="w-5 h-5" />}
              label="Overview"
            />
            <NavItem 
              active={activeTab === "accounts"} 
              onClick={() => setActiveTab("accounts")}
              icon={<Users className="w-5 h-5" />}
              label="Accounts"
            />
            <NavItem 
              active={activeTab === "campaigns"} 
              onClick={() => setActiveTab("campaigns")}
              icon={<ExternalLink className="w-5 h-5" />}
              label="Broadcasts"
            />
            <NavItem 
              active={activeTab === "logs"} 
              onClick={() => setActiveTab("logs")}
              icon={<Activity className="w-5 h-5" />}
              label="System Logs"
            />
            {isAdmin && (
              <NavItem 
                active={activeTab === "admin"} 
                onClick={() => setActiveTab("admin")}
                icon={<Shield className="w-5 h-5" />}
                label="Admin Portal"
              />
            )}
          </nav>
        </div>

        <div className="mt-auto p-6 space-y-4">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-500 hover:text-red-400 transition-all rounded-xl hover:bg-white/5 group"
          >
            <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Logout Session
          </button>
          
          <div className="p-4 bg-brand/[0.03] border border-brand/10 rounded-2xl">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
              <span className="text-[10px] font-bold text-brand uppercase tracking-tighter">Node Status</span>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed font-medium font-mono">
              ALL NODES OPERATIONAL<br/>
              LATENCY: 12ms
            </p>
          </div>

          <div className="pt-4 border-t border-white/5 opacity-60">
             <p className="text-[9px] font-black tracking-widest text-brand uppercase">Developer (Developed By)</p>
             <p className="text-[11px] font-black text-gray-400">@NoPasswordNo</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden pb-20 md:pb-0">
        <header className="h-20 border-b border-white/5 flex items-center px-10 bg-bg-dark/50 backdrop-blur-md sticky top-0 z-10">
          <div className="md:hidden flex items-center gap-3">
             <Send className="text-brand w-6 h-6" />
             <span className="font-black tracking-tighter text-white">TM PRO</span>
          </div>
          
          <div className="flex items-center gap-3">
             <div className="h-2 w-2 rounded-full bg-brand animate-pulse shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
             <h2 className="text-xs font-black tracking-widest text-white uppercase">{activeTab}</h2>
          </div>
          
          <div className="flex-1" />
          
          <div className="flex items-center gap-6">
             <div className="hidden sm:block text-right">
                <p className="text-[10px] font-black text-brand tracking-widest uppercase">Root Operator</p>
                <p className="text-[9px] text-gray-600 font-mono">ENCRYPTED_SUDO_ACCESS_GRANTED</p>
             </div>
             <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group hover:border-brand/30 transition-all cursor-pointer">
                <LayoutDashboard className="w-5 h-5 text-brand" />
             </div>
          </div>
        </header>

        {/* Mobile Nav */}
        <div className="fixed bottom-0 left-0 right-0 h-20 bg-bg-dark/80 backdrop-blur-xl border-t border-white/5 flex items-center justify-around px-4 md:hidden z-50">
          <button onClick={() => setActiveTab('dashboard')} className={`flex flex-col items-center gap-1 ${activeTab === 'dashboard' ? 'text-brand' : 'text-slate-500'}`}>
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-[8px] font-bold uppercase tracking-tighter">Home</span>
          </button>
          <button onClick={() => setActiveTab('accounts')} className={`flex flex-col items-center gap-1 ${activeTab === 'accounts' ? 'text-brand' : 'text-slate-500'}`}>
            <Users className="w-5 h-5" />
            <span className="text-[8px] font-bold uppercase tracking-tighter">Accounts</span>
          </button>
          <button onClick={() => setActiveTab('campaigns')} className={`flex flex-col items-center gap-1 ${activeTab === 'campaigns' ? 'text-brand' : 'text-slate-500'}`}>
            <ExternalLink className="w-5 h-5" />
            <span className="text-[8px] font-bold uppercase tracking-tighter">Ad Pulse</span>
          </button>
          <button onClick={() => setActiveTab('logs')} className={`flex flex-col items-center gap-1 ${activeTab === 'logs' ? 'text-brand' : 'text-slate-500'}`}>
            <Activity className="w-5 h-5" />
            <span className="text-[8px] font-bold uppercase tracking-tighter">Logs</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-10 scrollbar-hide">
          <AnimatePresence mode="wait">
            {activeTab === "dashboard" && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <StatCard label="Total Messages" value="0" delta="new" />
                  <StatCard label="Active Accounts" value="0" delta="ready" />
                  <StatCard label="Live Broadcasts" value="0" delta="idle" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="card h-[400px] flex flex-col">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-brand" />
                      Traffic Frequency
                    </h3>
                    <div className="flex-1 bg-black/40 rounded border border-line border-dashed flex items-center justify-center italic text-gray-600 text-sm">
                      Real-time stats will populate during broadcast
                    </div>
                  </div>
                  
                  <div className="card h-[400px] flex flex-col">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-brand" />
                      Recent Activity
                    </h3>
                    <div className="flex-1 overflow-y-auto font-mono text-[11px] text-gray-400 space-y-2 pr-2">
                      {logs.length === 0 ? (
                        <p className="text-gray-600 italic">Listening for events...</p>
                      ) : (
                        logs.map((log) => (
                          <LogItem 
                            key={log.id} 
                            time={log.time} 
                            msg={log.msg} 
                            status={log.status} 
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "accounts" && <AccountManager />}

            {activeTab === "admin" && isAdmin && <AdminPanel />}
            
            {activeTab === "logs" && (
              <motion.div 
                key="logs"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold">Bot System Logs</h3>
                  <button 
                    onClick={() => setLogs([])}
                    className="text-[10px] text-gray-500 hover:text-brand transition-colors uppercase tracking-widest font-bold"
                  >
                    Clear History
                  </button>
                </div>
                
                <div className="card min-h-[500px] flex flex-col">
                  <div className="flex-1 overflow-y-auto space-y-4 pr-2 font-mono scrollbar-hide">
                    {logs.length === 0 ? (
                      <div className="h-40 flex flex-col items-center justify-center text-gray-600 gap-4">
                        <Activity className="w-8 h-8 animate-pulse" />
                        <p className="italic text-sm">No critical logs reported yet.</p>
                      </div>
                    ) : (
                      logs.map((log) => (
                        <div key={log.id} className="p-4 bg-black/30 border border-white/5 rounded-xl group hover:bg-black/50 transition-all flex flex-col gap-2">
                           <div className="flex items-center justify-between">
                              <span className="text-[10px] text-gray-600 font-bold tracking-tighter">TIMESTAMP: {log.time}</span>
                              <span className={`text-[10px] font-black uppercase tracking-widest ${log.status === 'success' ? 'text-brand' : log.status === 'error' ? 'text-red-400' : 'text-blue-400'}`}>
                                STATUS: {log.status}
                              </span>
                           </div>
                           <p className={`text-sm break-all ${log.msg.startsWith('MASTER_BOT_SESSION_CODE') ? 'bg-brand/10 p-2 rounded border border-brand/20 select-all cursor-pointer' : ''}`}>
                             {log.msg.startsWith('MASTER_BOT_SESSION_CODE') ? (
                               <>
                                 <span className="text-brand font-bold mr-2">SESSION FOUND:</span>
                                 {log.msg.split(': ')[1]}
                                 <span className="block mt-2 text-[10px] text-brand/60 uppercase font-black tracking-widest">Click to select and copy</span>
                               </>
                             ) : log.msg}
                           </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "campaigns" && (
              <div className="h-full flex items-center justify-center card border-dashed border-line">
                 <p className="text-gray-500 italic">This module is under development...</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: any, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`sidebar-item w-full group ${active ? "sidebar-item-active" : "sidebar-item-inactive"}`}
    >
      {icon}
      <span className="font-semibold">{label}</span>
      {active && <motion.div layoutId="active-pill" className="ml-auto w-1.5 h-1.5 rounded-full bg-brand shadow-[0_0_8px_rgba(0,234,255,0.8)]" />}
    </button>
  );
}

function StatCard({ label, value, delta }: { label: string, value: string, delta: string }) {
  return (
    <div className="card group hover:border-brand/40 transition-all">
      <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <div className="flex items-end justify-between">
        <h4 className="text-3xl font-bold font-display">{value}</h4>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
          delta === "new" ? "bg-brand/10 text-brand" : "bg-gray-800 text-gray-400"
        }`}>
          {delta}
        </span>
      </div>
    </div>
  );
}

function LogItem({ time, msg, status }: any) {
  const colors: Record<string, string> = {
    success: 'text-brand',
    info: 'text-blue-400',
    error: 'text-red-400'
  };

  return (
    <div className="flex gap-4 border-b border-line/50 pb-2">
      <span className="text-gray-600 shrink-0">[{time}]</span>
      <span className={colors[status]}>{msg}</span>
    </div>
  );
}

