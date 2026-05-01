import { useState, useEffect } from "react";
import { 
  Shield, 
  UserPlus, 
  Zap, 
  Ban, 
  Unlock, 
  UserMinus, 
  UserCheck, 
  Info,
  Trash2,
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function AdminPanel() {
  const [loading, setLoading] = useState(false);
  const [specialUsers, setSpecialUsers] = useState<{ admins: number[], banned: number[], brandingDisabled: number[] }>({
    admins: [],
    banned: [],
    brandingDisabled: []
  });

  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/admin/special-users");
      if (!res.ok) throw new Error(`Fetch error: ${res.status}`);
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
          throw new Error("Server returned non-JSON data");
      }
      const data = await res.json();
      setSpecialUsers(data);
    } catch (e) {
      console.error("Admin data fetch error:", e);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleAction = async (endpoint: string, targetId: string | number, actionLabel?: string) => {
    const idNum = Number(targetId);
    if (isNaN(idNum)) return alert("Invalid ID");

    // Optimistic Update
    const prevUsers = { ...specialUsers };
    if (endpoint === "/api/admin/add") {
      setSpecialUsers(prev => ({ ...prev, admins: [...prev.admins, idNum] }));
    } else if (endpoint === "/api/admin/remove") {
      setSpecialUsers(prev => ({ ...prev, admins: prev.admins.filter(id => id !== idNum) }));
    } else if (endpoint === "/api/user/ban") {
      setSpecialUsers(prev => ({ ...prev, banned: [...prev.banned, idNum] }));
    } else if (endpoint === "/api/user/unban") {
      setSpecialUsers(prev => ({ ...prev, banned: prev.banned.filter(id => id !== idNum) }));
    } else if (endpoint === "/api/admin/branding") {
      setSpecialUsers(prev => {
        const exists = prev.brandingDisabled.includes(idNum);
        return {
          ...prev,
          brandingDisabled: exists ? prev.brandingDisabled.filter(id => id !== idNum) : [...prev.brandingDisabled, idNum]
        };
      });
    }

    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId })
      });
      if (res.ok) {
        if (actionLabel) showSuccess(`SUCCESS: ${actionLabel}`);
        fetchData();
      } else {
        const errorData = await res.json();
        setSpecialUsers(prevUsers); // Rollback
        alert(`Error: ${errorData.error || "Action failed"}`);
      }
    } catch (e) {
      console.error(e);
      setSpecialUsers(prevUsers); // Rollback
      alert("System error. Please check console.");
    } finally {
      setLoading(false);
    }
  };

  const confirmAndExecute = (msg: string, endpoint: string, targetId: string | number, label: string) => {
    if (window.confirm(msg)) {
      handleAction(endpoint, targetId, label);
    }
  };

  return (
    <div className="space-y-10 pb-20 relative">
      {/* Success Toast */}
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

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-tighter flex items-center gap-3">
            <Shield className="text-brand w-8 h-8" />
            Control Nexus
          </h2>
          <p className="text-slate-500 text-sm font-medium mt-1 uppercase tracking-widest text-[10px]">Sudo privileges active • System Management</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Permission Controls */}
        <div className="card bg-brand/[0.01]">
          <h3 className="text-xs font-black text-brand uppercase tracking-widest mb-8 flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            Identity Authorization
          </h3>
          <div className="space-y-6">
            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              const input = (e.currentTarget.elements.namedItem("userId") as HTMLInputElement);
              const targetId = input.value.trim();
              if (!targetId) return;
              confirmAndExecute(`Authorize user ${targetId} as Admin?`, "/api/admin/add", targetId, "ROOT GRANTED");
              input.value = "";
            }}>
              <div className="flex gap-2">
                <input name="userId" type="text" placeholder="Telegram User ID" className="glass-input !rounded-2xl" required />
                <button type="submit" disabled={loading} className="btn-primary !rounded-2xl min-w-[140px] h-[52px] text-sm shadow-xl shadow-brand/40">Grant Root</button>
              </div>
            </form>

            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              const input = (e.currentTarget.elements.namedItem("banId") as HTMLInputElement);
              const targetId = input.value.trim();
              if (!targetId) return;
              confirmAndExecute(`BLACKLIST user ${targetId}? This is irreversible.`, "/api/user/ban", targetId, "NODE BLACKLISTED");
              input.value = "";
            }}>
              <div className="flex gap-2">
                <input name="banId" type="text" placeholder="Violator User ID" className="glass-input !rounded-2xl border-red-500/20 focus:border-red-500/50" required />
                <button type="submit" disabled={loading} className="bg-red-500 text-white font-bold rounded-2xl px-6 py-2 hover:scale-[1.02] active:scale-[0.98] transition-all text-sm whitespace-nowrap shadow-xl shadow-red-500/40 min-w-[140px] h-[52px]">Blacklist Node</button>
              </div>
            </form>
          </div>
        </div>

        {/* Global Overrides */}
        <div className="card border-cyan-500/10">
          <h3 className="text-xs font-black text-white uppercase tracking-widest mb-8 flex items-center gap-2">
             <Zap className="w-4 h-4 text-cyan-400" />
             Infrastructure Overrides
          </h3>
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            const input = (e.currentTarget.elements.namedItem("brandUserId") as HTMLInputElement);
            const targetId = input.value.trim();
            if (!targetId) return;
            confirmAndExecute(`Toggle Branding Bypass for ID ${targetId}?`, "/api/admin/branding", targetId, "BYPASS UPDATED");
            input.value = "";
          }}>
            <input name="brandUserId" type="text" placeholder="Exception User ID" className="glass-input !rounded-2xl" required />
            <button type="submit" disabled={loading} className="btn-primary !rounded-2xl py-2 px-8 text-sm whitespace-nowrap transform-none h-[52px]">Bypass Branding</button>
          </form>
          <div className="mt-8 p-5 bg-white/[0.03] rounded-2xl border border-white/5">
            <div className="flex gap-3">
              <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                IDs added here are excluded from mandatory @username branding audits. Use with caution for trusted partners or internal nodes.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Registry Clusters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Root Registry */}
        <div className="card !p-0 overflow-hidden border-brand/10 bg-slate-900/20">
           <div className="p-5 border-b border-white/5 bg-brand/[0.03]">
              <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2 text-brand">
                 <Shield className="w-4 h-4" /> Root Operator Registry
              </h3>
           </div>
           <div className="divide-y divide-white/5 max-h-80 overflow-y-auto scrollbar-hide">
              {specialUsers.admins.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">No Root Nodes Connected</p>
                </div>
              ) : (
                specialUsers.admins.map(id => (
                  <div key={id} className="flex items-center justify-between p-5 hover:bg-white/[0.02] transition-all">
                     <div className="flex items-center gap-4">
                        <div className="w-2 h-2 rounded-full bg-brand shadow-[0_0_8px_var(--color-brand)]" />
                        <span className="text-xs font-mono font-bold text-slate-300">ID_{id}</span>
                     </div>
                     <button 
                       onClick={() => confirmAndExecute(`REVOKE ROOT PRIVILEGES for ${id}?`, "/api/admin/remove", id, "ROOT REVOKED")} 
                       className="btn-danger !py-2 !px-6 !rounded-2xl !text-[11px] h-10 shadow-lg shadow-red-500/30"
                     >
                        TERMINATE
                     </button>
                  </div>
                ))
              )}
           </div>
        </div>

        {/* Blacklist Audit */}
        <div className="card !p-0 overflow-hidden border-red-500/10 bg-slate-900/20">
           <div className="p-5 border-b border-white/5 bg-red-500/[0.03]">
              <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2 text-red-400">
                 <Ban className="w-4 h-4" /> Blacklisted Node Audit
              </h3>
           </div>
           <div className="divide-y divide-white/5 max-h-80 overflow-y-auto scrollbar-hide">
              {specialUsers.banned.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Clean Registry</p>
                </div>
              ) : (
                specialUsers.banned.map(id => (
                  <div key={id} className="flex items-center justify-between p-5 hover:bg-white/[0.02] transition-all">
                     <span className="text-xs font-mono font-bold text-slate-400">UID_{id}</span>
                     <button 
                       onClick={() => confirmAndExecute(`RESTORE ACCESS (Unban) for node ${id}?`, "/api/user/unban", id, "NODE RESTORED")} 
                       className="btn-danger !py-2 !px-6 !rounded-2xl !text-[11px] h-10 shadow-lg shadow-red-500/30"
                     >
                        TERMINATE
                     </button>
                  </div>
                ))
              )}
           </div>
        </div>

        {/* Bypass Audit */}
        <div className="card !p-0 overflow-hidden border-cyan-500/10 bg-slate-900/20">
           <div className="p-5 border-b border-white/5 bg-cyan-500/[0.03]">
              <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2 text-cyan-400">
                 <Zap className="w-4 h-4" /> Active Bypass Nodes
              </h3>
           </div>
           <div className="divide-y divide-white/5 max-h-80 overflow-y-auto scrollbar-hide">
              {specialUsers.brandingDisabled.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">Default Branding Active</p>
                </div>
              ) : (
                specialUsers.brandingDisabled.map(id => (
                  <div key={id} className="flex items-center justify-between p-5 hover:bg-white/[0.02] transition-all">
                     <span className="text-xs font-mono font-bold text-slate-300">ID_{id}</span>
                     <button 
                       onClick={() => confirmAndExecute(`RE-ENABLE MANDATORY BRANDING for node ${id}?`, "/api/admin/branding", id, "BYPASS REMOVED")} 
                       className="btn-danger !py-2 !px-6 !rounded-2xl !text-[11px] h-10 shadow-lg shadow-red-500/30"
                     >
                        TERMINATE
                     </button>
                  </div>
                ))
              )}
           </div>
        </div>
      </div>
    </div>
  );
}
