// src/components/OrderForm.tsx
import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

interface Props {
  selectedLocation: { lat: number; lng: number } | null;
}

const OrderForm: React.FC<Props> = ({ selectedLocation }) => {
  const [loading, setLoading] = useState(false);

  const createOrder = async (type: 'egypt' | 'home', amount: number) => {
    if (!selectedLocation) return alert("Tap on map first! 📍");
    
    setLoading(true);
    const { error } = await supabase.from('pyramids').insert([
      {
        location: `POINT(${selectedLocation.lng} ${selectedLocation.lat})`,
        mission_type: type,
        current_amount: amount,
        status: 'active'
      }
    ]);

    if (error) alert(error.message);
    else alert("Wallet Cleaned! Pyramid Activated 📐");
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-[10px] text-gray-500 uppercase tracking-[0.2em] mb-4">
        {selectedLocation
          ? `Target: ${selectedLocation.lat.toFixed(4)}, ${selectedLocation.lng.toFixed(4)}`
          : "Select location on map"}
      </p>

      <button
        disabled={loading}
        onClick={() => createOrder('egypt', 1)}
        className="w-full py-4 bg-[#39FF14]/10 border border-[#39FF14] text-[#39FF14] rounded-xl font-black italic hover:bg-[#39FF14] hover:text-black transition-all"
      >
        ACTIVATE CITY PYRAMID ($1)
      </button>

      <button
        disabled={loading}
        onClick={() => createOrder('home', 5)}
        className="w-full py-4 bg-[#BC13FE]/10 border border-[#BC13FE] text-[#BC13FE] rounded-xl font-black italic hover:bg-[#BC13FE] hover:text-white transition-all"
      >
        ACTIVATE HOME PYRAMID ($5)
      </button>
    </div>
  );
};

export default OrderForm;
