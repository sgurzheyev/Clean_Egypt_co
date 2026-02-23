import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Auth() {
const [loading, setLoading] = useState(false)
const [email, setEmail] = useState('')
const [password, setPassword] = useState('')
const [fullName, setFullName] = useState('')
const [phone, setPhone] = useState('')
const [isRegister, setIsRegister] = useState(false)

const handleAuth = async (e: any) => {
e.preventDefault()
setLoading(true)

}

return (
<div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '10px', maxWidth: '400px', margin: '20px auto', backgroundColor: '#fff', color: '#000' }}>
<h2 style={{ textAlign: 'center' }}>{isRegister ? 'Регистрация' : 'Вход'}</h2>
<form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
{isRegister && (
<>
<input style={{ padding: '8px' }} placeholder="Имя Фамилия" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
<input style={{ padding: '8px' }} placeholder="Телефон" value={phone} onChange={(e) => setPhone(e.target.value)} required />
</>
)}
<input style={{ padding: '8px' }} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
<input style={{ padding: '8px' }} type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} required />
<button type="submit" disabled={loading} style={{ padding: '10px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
{loading ? 'Секунду...' : isRegister ? 'Создать аккаунт' : 'Войти'}
</button>
</form>
<button onClick={() => setIsRegister(!isRegister)} style={{ marginTop: '15px', background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', width: '100%' }}>
{isRegister ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Регистрация'}
</button>
</div>
)
}
