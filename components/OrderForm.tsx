// ... (оставляем все импорты как есть, они теперь правильные)

const OrderForm: React.FC<OrderFormProps> = ({ mode, language }) => {
  // ... (оставляем всю логику handleSubmit без изменений)

  return (
    <form onSubmit={handleSubmit} className="p-8 space-y-6 bg-[#111111] rounded-[2.5rem] border border-white/5 shadow-2xl text-white w-full max-w-lg transition-all duration-500 hover:border-[#39FF14]/30">
      <h2 className="text-xl font-black italic text-[#39FF14] tracking-tighter uppercase ml-2">Mission Details</h2>
      
      <div className="space-y-4">
        <input
          type="email"
          placeholder="Email Address"
          required
          className="w-full p-5 bg-black border border-white/10 rounded-2xl outline-none focus:border-[#39FF14] text-white transition-all placeholder:text-zinc-600"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Name"
            required
            className="w-1/2 p-5 bg-black border border-white/10 rounded-2xl outline-none focus:border-[#39FF14] text-white transition-all placeholder:text-zinc-600"
            value={clientName}
            onChange={e => setClientName(e.target.value)}
          />
          <input
            type="tel"
            placeholder="Phone"
            required
            className="w-1/2 p-5 bg-black border border-white/10 rounded-2xl outline-none focus:border-[#BC13FE] text-white transition-all placeholder:text-zinc-600"
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-black/40 p-6 rounded-3xl border border-white/5 space-y-6">
        <Slider label={t('size_slider_title')} min={MIN_SIZE} max={MAX_SIZE} value={size} onChange={e => setSize(Number(e.target.value))} unit="sq.m." />
        <Slider label="Your Offer" min={isHomeMode ? HOME_MIN_PRICE : CITY_MIN_PRICE} max={isHomeMode ? HOME_MAX_PRICE : CITY_MAX_PRICE} value={price} onChange={e => setPrice(Number(e.target.value))} displayValue={`$${price}`} />
      </div>

      <PhotoUploader files={photos} setFiles={setPhotos} language={language} />

      <textarea
        placeholder="Any specific details? (Optional)"
        className="w-full p-5 bg-black border border-white/10 rounded-2xl outline-none focus:border-[#39FF14] text-white transition-all placeholder:text-zinc-600"
        rows={3}
        value={comment}
        onChange={e => setComment(e.target.value)}
      />

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-6 rounded-2xl bg-gradient-to-r from-[#39FF14] to-[#BC13FE] text-black font-black uppercase italic hover:scale-[1.02] active:scale-95 transition-all shadow-[0_0_20px_rgba(57,255,20,0.2)]"
      >
        {isSubmitting ? <SpinnerIcon /> : "Deploy Mission 🚀"}
      </button>
    </form>
  );
};
