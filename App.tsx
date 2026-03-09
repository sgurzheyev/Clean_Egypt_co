import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MapPicker from './components/MapPicker';
import Auth from './components/Auth';
import Profile from './components/Profile';
import TryFree from './components/TryFree';
import VerificationPage from './components/VerificationPage';
import { supabase } from './services/supabase';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_event, session) => setSession(session));
  }, []);

  return (
    <Router>
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
      </div>
    </Router>
  );
};

export default App;
