import React, { useState } from 'react';
import { supabase } from '../services/supabase';

interface AuthOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AuthOverlay: React.FC<AuthOverlayProps> = ({ isOpen, onClose, onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'signin' | 'magic'>('signin');

  if (!isOpen) return null;

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email?.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setIsLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) throw err;
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Sign in failed. Check your email and password.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email?.trim()) return;
    setIsLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (err) throw err;
      setError(null);
      setMode('signin');
      onClose();
      alert('Check your email for the magic link. Click it to sign in.');
    } catch (err: any) {
      setError(err?.message || 'Failed to send magic link.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'google' });
      if (err) throw err;
    } catch (err: any) {
      setError(err?.message || 'Google sign-in failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-black/90 backdrop-blur-xl border border-white/10 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-xl font-black uppercase tracking-[0.18em] text-white">
            Sign In
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="text-slate-400 hover:text-white text-lg font-bold disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {mode === 'signin' ? (
          <form onSubmit={handlePasswordSignIn} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            {error && (
              <p className="text-xs text-red-400 font-medium">{error}</p>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] bg-emerald-500 text-black shadow-[0_0_24px_rgba(52,211,153,0.6)] hover:brightness-110 disabled:opacity-60 disabled:cursor-wait transition-all"
            >
              {isLoading ? 'Signing in...' : 'Sign In with Password'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMagicLink} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-2xl bg-black/40 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                required
              />
            </div>
            {error && (
              <p className="text-xs text-red-400 font-medium">{error}</p>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.24em] bg-slate-600 text-white hover:bg-slate-500 disabled:opacity-60 disabled:cursor-wait transition-all"
            >
              {isLoading ? 'Sending...' : 'Send Magic Link'}
            </button>
          </form>
        )}

        <div className="mt-4 space-y-3">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full rounded-full px-6 py-3 text-sm font-bold uppercase tracking-[0.2em] bg-white/10 border border-white/20 text-white hover:bg-white/15 disabled:opacity-60 transition-all"
          >
            Sign in with Google
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === 'signin' ? 'magic' : 'signin')}
            className="w-full text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider"
          >
            {mode === 'signin' ? 'No password? Send magic link' : 'Back to password sign in'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthOverlay;
