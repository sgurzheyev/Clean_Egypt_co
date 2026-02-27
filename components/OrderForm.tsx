import React, { useState } from 'react';
import { generatePaymobLink } from '../lib/paymob';

interface OrderFormProps {
  selectedLocation: { lat: number; lng: number } | null;
}

const OrderForm: React.FC<OrderFormProps> = ({ selectedLocation }) => {
  const [tempEmail] = useState('sgurzheyev@gmail.com');
  const [step, setStep] = useState<'start' | 'choose' | 'payment'>('start');
  const [missionType, setMissionType] = useState<'egypt' | 'home' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  const handleStartClick = () => {
    if (!selectedLocation) {
      alert("Please select a location on the map first!");
      return;
    }
    setStep('choose');
  };

  const handleTypeSelection = async (type: 'egypt' | 'home') => {
    setMissionType(type);
    setIsSubmitting(true);
    const amount = type === 'egypt' ? 1.00 : 5.00;

    try {
      const url = await generatePaymobLink(amount, tempEmail, "Clean", type.toUpperCase());
      if (url) {
        setPaymentUrl(url);
        setStep('payment');
      } else {
        alert("Connection to PayMob failed.");
        setStep('choose');
      }
    } catch (error) {
      alert("Something went wrong.");
      setStep('choose');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-[#111] p-6 rounded-3xl border border-white/10 shadow-2xl relative w-full transition-all duration-300 mt-8">
      
      {step === 'start' && (
        <div className="flex flex-col items-center">
           {/* ВАШ НОВЫЙ ЗАГОЛОВОК */}
           <h2 className="text-2xl font-black italic uppercase text-white tracking-tighter mb-4">
             Clean it <span className="text-[#39FF14]">For</span>
           </h2>

           {selectedLocation ? (
             <div className="w-full bg-[#39FF14]/10 border border-[#39FF14]/50 rounded-xl p-4 mb-6 text-center shadow-[0_0_15px_rgba(57,255,20,0.1)]">
                <p className="text-[#39FF14] font-black uppercase text-sm animate-pulse">📍 Location Secured</p>
                <p className="text-[#39FF14]/70 text-[10px] font-mono mt-1">
                  {selectedLocation.lat.toFixed(5)}, {selectedLocation.lng.toFixed(5)}
                </p>
             </div>
           ) : (
             <div className="w-full h-20 border border-white/10 border-dashed rounded-xl flex items-center justify-center mb-6">
                <p className="text-white/30 text-xs uppercase font-bold tracking-widest">Tap map to set pin</p>
             </div>
           )}

           {/* ВАША НОВАЯ КНОПКА (ТЕПЕРЬ ЯРКАЯ И ЧИТАЕМАЯ) */}
           <button
             onClick={handleStartClick}
             disabled={!selectedLocation}
             className="w-full bg-[#39FF14] text-black font-black py-5 rounded-2xl uppercase text-lg tracking-tight transition-all active:scale-[0.98] disabled:opacity-50 disabled:bg-gray-800 disabled:text-gray-500 shadow-[0_0_20px_rgba(57,255,20,0.3)]"
           >
             Starts from 1$ 🚀
           </button>
        </div>
      )}

      {step === 'choose' && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <h3 className="text-white font-black italic text-center uppercase mb-4 text-xl">Select Type</h3>
          
          <button onClick={() => handleTypeSelection('egypt')} disabled={isSubmitting} className="w-full bg-black border-2 border-[#BC13FE] hover:bg-[#BC13FE]/10 p-5 rounded-2xl text-left transition-all">
             <div className="flex justify-between items-center">
               <div>
                 <p className="text-[#BC13FE] font-black uppercase text-lg italic">CleanMyEgypt</p>
                 <p className="text-white/50 text-[10px] uppercase mt-1">City Cleanup</p>
               </div>
               <span className="bg-[#BC13FE] text-white font-bold px-3 py-1 rounded-lg text-xs">GO $1</span>
             </div>
          </button>

          <button onClick={() => handleTypeSelection('home')} disabled={isSubmitting} className="w-full bg-black border-2 border-[#FFD700] hover:bg-[#FFD700]/10 p-5 rounded-2xl text-left transition-all">
             <div className="flex justify-between items-center">
               <div>
                 <p className="text-[#FFD700] font-black uppercase text-lg italic">CleanMyHome</p>
                 <p className="text-white/50 text-[10px] uppercase mt-1">Private Bidding</p>
               </div>
               <span className="bg-[#FFD700] text-black font-black px-3 py-1 rounded-lg text-xs">GO $5</span>
             </div>
          </button>

          <button onClick={() => setStep('start')} className="w-full text-center text-[10px] text-white/50 hover:text-white uppercase tracking-widest mt-4">← Back</button>
        </div>
      )}

      {step === 'payment' && (
        <div className="h-[400px] flex flex-col animate-in fade-in duration-300">
           <h2 className="text-lg font-black italic uppercase text-white mb-4">Secure Checkout</h2>
           <div className={`flex-grow bg-white rounded-xl overflow-hidden border-2 relative ${missionType === 'egypt' ? 'border-[#BC13FE]' : 'border-[#FFD700]'}`}>
              {paymentUrl ? (
                <iframe src={paymentUrl} className="w-full h-full border-0" allow="payment" />
              ) : (
                <div className="flex items-center justify-center h-full text-black font-bold">Loading...</div>
              )}
           </div>
           <button onClick={() => setStep('choose')} className="mt-4 text-[10px] text-white/50 uppercase tracking-widest hover:text-white transition-colors">← Cancel Payment</button>
        </div>
      )}
    </div>
  );
};

export default OrderForm;
