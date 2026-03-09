import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MapPicker from './components/MapPicker';
import Auth from './components/Auth';
import Profile from './components/Profile';
import TryFree from './components/TryFree';
import VerificationPage from './components/VerificationPage';
import { supabase } from './services/supabase';

const App: React.FC = () => (
  <Router>
    <AppContent />
  </Router>
);

function AppContent() {
  const location = useLocation();
  const [session, setSession] = useState<any>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSuccessType, setPaymentSuccessType] = useState<'job' | 'deposit'>('job');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_event, session) => setSession(session));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const isSuccess =
      params.get('payment') === 'success' || params.get('success') === 'true';

    if (isSuccess) {
      const returnType = sessionStorage.getItem('paymentReturnType');
      setPaymentSuccessType(returnType === 'deposit' ? 'deposit' : 'job');
      setShowPaymentModal(true);
      sessionStorage.removeItem('paymentReturnType');
      window.history.replaceState({}, '', location.pathname);
      window.dispatchEvent(new CustomEvent('paymentSuccess'));
    }
  }, [location.search, location.pathname]);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      <Routes>
        <Route path="/" element={
            <div className="fixed inset-0 z-0 w-full h-full">
              <MapPicker
                onLocationSelect={() => {}}
                selectedCoords={null}
              />
            </div>
          } />

          <Route path="/auth" element={!session ? <Auth /> : <Navigate to="/profile" />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/verify" element={<VerificationPage />} />

          <Route path="/try-free" element={<TryFree />} />
        </Routes>

      {showPaymentModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setShowPaymentModal(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-black/85 backdrop-blur-xl border border-white/10 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 border border-emerald-500/40 mb-4">
                <span className="text-2xl">✓</span>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                Payment successful
              </h3>
              <p className="text-slate-400 text-sm mb-6">
                {paymentSuccessType === 'deposit'
                  ? 'Deposit paid successfully! Mission is yours.'
                  : 'Deposit paid successfully! Job is now live on the map.'}
              </p>
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="w-full rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.2em] bg-emerald-500 text-black shadow-[0_0_24px_rgba(52,211,153,0.6)] hover:brightness-110 transition-all"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
