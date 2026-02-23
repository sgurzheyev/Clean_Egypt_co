import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

const Auth: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegister) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin }
        });
        if (error) throw error;
        alert('Success! Check your email.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        alert('Welcome!');
      }
    } catch (error: any) {
      alert('Error: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#111111] p-8 rounded-3xl w-80 mx-auto border border-white/5">
      <h2 className="text-xl font-bold mb-4 text-center">{isRegister ? 'Register' : 'Login'}</h2>
      <form onSubmit={handleAuth} className="space-y-4">
        <input type="email" placeholder="Email" className="w-full bg-black p-3 rounded-xl border border-white/10" value={email} onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" className="w-full bg-black p-3 rounded-xl border border-white/10" value={password} onChange={e => setPassword(e.target.value)} required />
        <button type="submit" disabled={loading} className="w-full bg-[#39FF14] text-black font-bold py-3 rounded-xl">
          {loading ? 'Wait...' : (isRegister ? 'Sign Up' : 'Sign In')}
        </button>
      </form>
      <button onClick={() => setIsRegister(!isRegister)} className="w-full mt-4 text-sm text-[#BC13FE]">
        {isRegister ? 'Have account? Login' : 'Need account? Register'}
      </button>
    </div>
  );
};

export default Auth;
