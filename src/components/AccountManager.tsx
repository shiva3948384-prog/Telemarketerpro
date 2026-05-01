import React, { useState, useEffect } from "react";
import { 
  Plus, 
  Upload, 
  Trash2, 
  Play, 
  Square, 
  Key, 
  CheckCircle2, 
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Activity,
  Users
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Account {
  id: string;
  firstName: string;
  username?: string;
  phone?: string;
  isBroadcastRunning?: boolean;
}

export default function AccountManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sessionInput, setSessionInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [broadcastMsg, setBroadcastMsg] = useState("🔥 Super Offer! Join our VIP group now: https://t.me/example");
  const [interval, setIntervalMins] = useState(10);
  const [fetching, setFetching] = useState(true);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const res = await fetch("/api/accounts");
        if (!res.ok) throw new Error("Server error fetching accounts");
        
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
           console.error("Non-JSON Response from /api/accounts", await res.text());
           throw new Error("Invalid server response format");
        }

        const data = await res.json();
        if (data.loading) {
            // Retry in 2 seconds if server is still loading data
            setTimeout(fetchAccounts, 2000);
            return;
        }
        if (Array.isArray(data)) setAccounts(data);
      } catch (err) {
        console.error("Fetch accounts error:", err);
      } finally {
        setFetching(false);
      }
    };
    fetchAccounts();
  }, []);

  const handleAddAccount = async (session: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionString: session })
      });
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);

      setAccounts(prev => [...prev, data.account]);
      setSessionInput("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) handleAddAccount(text.trim());
    };
    reader.readAsText(file);
  };

  const toggleBroadcast = async (accountId: string, isRunning: boolean) => {
    try {
      const endpoint = isRunning ? "/api/campaign/stop" : "/api/campaign/start";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          accountId, 
          message: broadcastMsg, 
          interval 
        })
      });
      const data = await res.json();
      
      if (data.success) {
        showSuccess("Action Successful");
        setAccounts(prev => prev.map(acc => 
          acc.id === accountId ? { ...acc, isBroadcastRunning: !isRunning } : acc
        ));
      }
    } catch (err) {
      console.error("Broadcast toggle error:", err);
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    if (!window.confirm("Are you sure you want to disconnect this node?")) return;
    
    try {
      const res = await fetch("/api/accounts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId })
      });
      const data = await res.json();
      if (data.success) {
        showSuccess("Node Disconnected Successfully");
        setAccounts(prev => prev.filter(acc => acc.id !== accountId));
      }
    } catch (err) {
      console.error("Delete account error:", err);
    }
  };

  const handleBroadcastFinish = () => {
    showSuccess("Broadcast settings saved successfully!");
  };

  return (
    <div className="space-y-12 relative text-slate-300">
      <AnimatePresence>
        {successMsg && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-10 right-10 z-50 bg-brand text-white px-8 py-4 rounded-2xl shadow-2xl shadow-brand/40 flex items-center gap-4 font-black text-sm border border-white/20"
          >
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center animate-pulse">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            {successMsg}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Broadcast Settings and Account Entry */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Settings & Add */}
        <div className="lg:col-span-2 space-y-8">
          <div className="card border-brand/10 bg-brand/[0.01]">
            <h3 className="text-xl font-bold mb-8 flex items-center gap-3">
              <Plus className="w-5 h-5 text-brand" />
              Broadcast Configuration
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
               <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">Ad Template</label>
                  <textarea 
                    value={broadcastMsg}
                    onChange={(e) => setBroadcastMsg(e.target.value)}
                    placeholder="Enter your ad copy here..."
                    className="glass-input h-32 resize-none leading-relaxed"
                  />
               </div>
               <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">Interval (Mins)</label>
                    <input 
                      type="number"
                      value={interval}
                      onChange={(e) => setIntervalMins(parseInt(e.target.value) || 1)}
                      className="glass-input"
                    />
                  </div>
                  
                  <div className="pt-4 border-t border-white/5">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter mb-2">Notice</p>
                    <p className="text-[10px] text-gray-500 italic leading-relaxed">
                      Broadcast settings apply to all accounts started below.
                    </p>
                  </div>
               </div>
            </div>

            <button 
              onClick={handleBroadcastFinish}
              className="btn-primary w-full h-12 flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              Done
            </button>
          </div>

          <div className="card border-white/5 bg-white/[0.01]">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-3">
              <Plus className="w-5 h-5 text-brand" />
              Connect New Node
            </h3>

            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">Session String</label>
                <textarea 
                  value={sessionInput}
                  onChange={(e) => setSessionInput(e.target.value)}
                  placeholder="Paste session string here..."
                  className="glass-input h-24 font-mono text-xs"
                />
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-4">
                <button 
                  onClick={() => handleAddAccount(sessionInput)}
                  disabled={loading || !sessionInput}
                  className="w-full sm:flex-1 btn-primary flex items-center justify-center gap-3 h-12"
                >
                  {loading ? <div className="w-5 h-5 border-2 border-black/20 border-t-black animate-spin rounded-full" /> : <Plus className="w-5 h-5" />}
                  Connect Node
                </button>

                <div className="relative w-full sm:w-auto">
                  <input 
                    type="file" 
                    accept=".txt" 
                    onChange={handleFileUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer z-10"
                  />
                  <button className="w-full bg-white/5 border border-white/10 text-white font-bold rounded-xl px-6 py-3 hover:bg-white/10 transition-all flex items-center justify-center gap-3 h-12">
                    <Upload className="w-5 h-5 text-cyan-400" />
                    Bulk Import
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-3 text-red-400 text-xs bg-red-500/10 p-4 border border-red-500/20 rounded-2xl">
                  <AlertCircle className="w-5 h-5" />
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Info Column */}
        <div className="space-y-6">
          <div className="card border-brand/20 bg-brand/[0.01] relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-brand/5 rounded-full -mr-12 -mt-12 blur-3xl transition-all group-hover:bg-brand/10" />
            <h4 className="text-xs font-black text-brand uppercase tracking-widest mb-4">Branding Protocol</h4>
            <p className="text-[11px] text-gray-400 leading-relaxed font-medium">
              To maintain system integrity, a mandatory branding snippet <span className="text-brand font-bold">"via @TeleMarketerProNews"</span> will be appended to your profile Last Name and Bio.
            </p>
          </div>
          
          <div className="card">
            <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-6">Security Certificate</h4>
            <ul className="space-y-5">
               <FeatureInfo icon={<Key className="w-4 h-4" />} label="AES-256 SESSION ENCRYPTION" />
               <FeatureInfo icon={<ShieldCheck className="w-4 h-4" />} label="NON-PERSISTENT DATA LOGS" />
               <FeatureInfo icon={<Activity className="w-4 h-4" />} label="REAL-TIME ANOMALY DETECTION" />
            </ul>
          </div>

          <div className="p-6 rounded-2xl bg-gradient-to-br from-cyan-500/10 to-violet-500/10 border border-white/5 flex flex-col items-center text-center">
             <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
                <Users className="text-brand w-6 h-6" />
             </div>
             <p className="text-xs font-bold text-white mb-2 uppercase tracking-tighter">Community Nodes</p>
             <p className="text-[10px] text-gray-600 mb-6">Connect with fellow advertisers and share strategies.</p>
             <button className="btn-ghost w-full py-2 text-xs">Join Discord</button>
          </div>
        </div>
      </div>

      {/* Account List */}
      <div className="space-y-6 pt-10">
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-black flex items-center gap-3 tracking-tighter">
            Active Deployments
            <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[10px] font-mono text-cyan-400 uppercase tracking-widest">
              Nodes: {accounts.length}
            </div>
          </h3>
        </div>

        {accounts.length === 0 ? (
          <div className="card border-dashed py-24 flex flex-col items-center justify-center text-gray-600 border-white/10">
             <div className="w-20 h-20 rounded-full bg-white/[0.01] border border-white/5 flex items-center justify-center mb-6">
                <Users className="w-10 h-10 opacity-20" />
             </div>
             <p className="text-sm font-medium italic opacity-50 uppercase tracking-widest shadow-brand">Waiting for secure connection...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {accounts.map(acc => (
              <motion.div 
                key={acc.id}
                layout
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                className="card border-white/5 hover:border-brand/40 group transition-all relative overflow-hidden"
              >
                <div className="flex items-start justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand/20 to-brand/5 border border-brand/20 flex items-center justify-center text-brand text-xl font-black shadow-[0_0_15px_rgba(0,234,255,0.1)]">
                      {acc.firstName[0]}
                    </div>
                    <div>
                      <h4 className="font-black text-lg tracking-tight text-white">{acc.firstName}</h4>
                      <p className="text-xs text-gray-500 font-mono tracking-tighter opacity-70">NODE_{acc.id.slice(-6)}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDeleteAccount(acc.id)}
                    className="p-2 text-gray-700 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="p-3 bg-white/[0.02] rounded-xl border border-white/5">
                    <p className="text-[9px] font-black text-gray-600 uppercase tracking-widest mb-2">Connectivity</p>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-brand animate-pulse shadow-[0_0_10px_#00eaff]" />
                      <span className="text-xs font-bold text-gray-300">ONLINE</span>
                    </div>
                  </div>
                  <div className="p-3 bg-white/[0.02] rounded-xl border border-white/5">
                    <p className="text-[9px] font-black text-gray-600 uppercase tracking-widest mb-2">Identity</p>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-brand" />
                      <span className="text-xs font-bold text-gray-300">BRANDED</span>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => toggleBroadcast(acc.id, !!acc.isBroadcastRunning)}
                  className={`w-full h-14 flex items-center justify-center gap-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${
                    acc.isBroadcastRunning 
                      ? "bg-red-500 text-white hover:bg-red-600 shadow-[0_0_30px_rgba(239,68,68,0.3)]" 
                      : "btn-primary"
                  }`}
                >
                  {acc.isBroadcastRunning ? (
                    <>
                      <Square className="w-5 h-5 fill-current" />
                      Stop Broadcast
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-current" />
                      Start Broadcast
                    </>
                  )}
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureInfo({ icon, label }: { icon: any, label: string }) {
  return (
    <li className="flex items-center gap-3 text-[10px] font-black text-gray-500 uppercase tracking-widest">
      <div className="text-brand p-1.5 bg-brand/10 rounded-lg">{icon}</div>
      {label}
    </li>
  );
}
