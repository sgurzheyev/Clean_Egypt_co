import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

const Auth: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) alert(error.message);
    else alert('Проверь почту!');
    setLoading(false);
  };

  return (
    <form onSubmit={handleRegister} className="bg-zinc-900 p-8 rounded-2xl w-80">
      <input type="email" placeholder="Email" className="w-full mb-4 p-2 bg-black border border-zinc-700" onChange={e => setEmail(e.target.value)} required />
      <input type="password" placeholder="Пароль" className="w-full mb-4 p-2 bg-black border border-zinc-700" onChange={e => setPassword(e.target.value)} required />
      <button type="submit" disabled={loading} className="w-full bg-green-500 p-2 text-black font-bold">
        {loading ? 'Секунду...' : 'Зарегистрироваться'}
      </button>
    </form>
  );
};

export default Auth;
