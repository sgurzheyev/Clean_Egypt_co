import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

const Auth: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegister) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, phone: phone },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        alert('Успех! Проверьте почту для подтверждения.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error: any) {
      alert('Ошибка: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#111111] border border-white/5 rounded-3xl p-8 w-full max-w-md mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-center">{isRegister ? 'Регистрация' : 'Вход'}</h2>
      <form onSubmit={handleAuth} className="space-y-4">
        {isRegister && (
          <>
            <input type="text" placeholder="Имя" className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            <input type="text" placeholder="Телефон" className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </>
        )}
        <input type="email" placeholder="Email" className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Пароль" className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit" disabled={loading} className="w-full bg-[#39FF14] text-black font-bold py-4 rounded-xl disabled:opacity-50">
          {loading ? 'Секунду...' : (isRegister ? 'Создать аккаунт' : 'Войти')}
        </button>
      </form>
      <button onClick={() => setIsRegister(!isRegister)} className="w-full mt-4 text-sm text-[#BC13FE]">
        {isRegister ? 'Уже есть аккаунт? Войти' : 'Нужен аккаунт? Регистрация'}
      </button>
    </div>
  );
};

export default Auth;
