import React, { useState } from "react";
import { Key, ShieldAlert, Lock, User, Send } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface LoginProps {
  onLogin: (data: { key?: string; isAdmin?: boolean }) => void;
}

export default function LoginPage({ onLogin }: LoginProps) {
  const [adminUser, setAdminUser] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: adminUser, password: adminPass }),
      });
      const data = await res.json();
      if (data.success) {
        onLogin({ isAdmin: true });
      } else {
        setError(data.error || "Invalid Admin Credentials");
      }
    } catch (err) {
      setError("Server connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-dark flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full"
      >
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-brand/10 border border-brand/20 mb-6 shadow-[0_0_30px_rgba(0,234,255,0.15)]">
            <Send className="text-brand w-10 h-10" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tighter mb-2">TM PRO</h1>
          <p className="text-gray-500 font-medium">Advertising Infrastructure • V2.5</p>
        </div>

        <div className="card backdrop-blur-3xl bg-white/[0.02] border-white/5 p-8">
          <div className="mb-8">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-brand" />
              Sudo Authentication
            </h2>
            <p className="text-xs text-gray-500 mt-1">Authorized personnel restricted access</p>
          </div>

          <form onSubmit={handleAdminLogin} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">Username</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                  <input
                    type="text"
                    className="glass-input pl-12"
                    placeholder="Admin ID"
                    value={adminUser}
                    onChange={(e) => setAdminUser(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">Security Token</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                  <input
                    type="password"
                    className="glass-input pl-12"
                    placeholder="••••••••"
                    value={adminPass}
                    onChange={(e) => setAdminPass(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>
            {error && (
              <motion.div 
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 text-xs text-red-400 p-4 bg-red-500/10 rounded-xl border border-red-500/20"
              >
                <ShieldAlert className="w-4 h-4" />
                {error}
              </motion.div>
            )}
            <button type="submit" disabled={loading} className="w-full btn-primary h-12 flex items-center justify-center">
                {loading ? <div className="w-5 h-5 border-2 border-black/20 border-t-black animate-spin rounded-full" /> : "Access System Core"}
            </button>
          </form>
        </div>

        <div className="flex items-center justify-center gap-2 mt-10 opacity-50">
          <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
          <p className="text-[10px] text-gray-500 font-mono tracking-widest uppercase">
            Encrypted Session Active
          </p>
        </div>
      </motion.div>
    </div>
  );
}
