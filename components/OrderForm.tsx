return (
    // Градиентная рамка (Green to Purple) и полупрозрачный черный фон внутри
    <div className="w-full max-w-lg p-[2px] bg-gradient-to-br from-[#39FF14] via-blue-500 to-[#BC13FE] rounded-[2.5rem] shadow-[0_0_40px_rgba(57,255,20,0.3)] animate-pulse-slow">
      <form onSubmit={handleSubmit} className="p-6 space-y-5 bg-[#0a0a0a]/90 backdrop-blur-xl rounded-[2.4rem] text-white relative overflow-hidden">
        
        {/* Неоновый блик сверху */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-1 bg-[#39FF14] blur-md rounded-full opacity-50"></div>

        <h2 className="text-3xl font-black italic text-transparent bg-clip-text bg-gradient-to-r from-[#39FF14] to-white uppercase tracking-tighter text-center mb-6">
          Mission Control
        </h2>
        
        <input
          type="email"
          placeholder="Email"
          required
          className="w-full p-4 bg-black/50 border border-white/10 rounded-2xl outline-none focus:border-[#39FF14] transition-colors placeholder:text-gray-500"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Name"
            required
            className="w-1/2 p-4 bg-black/50 border border-white/10 rounded-2xl outline-none focus:border-[#39FF14] transition-colors placeholder:text-gray-500"
            value={clientName}
            onChange={e => setClientName(e.target.value)}
          />
          <input
            type="tel"
            placeholder="Phone"
            required
            className="w-1/2 p-4 bg-black/50 border border-white/10 rounded-2xl outline-none focus:border-[#BC13FE] transition-colors placeholder:text-gray-500"
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
        </div>

        <div className="bg-black/40 p-4 rounded-3xl border border-white/5 space-y-4">
          <Slider
            label={t('size_slider_title')}
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={size}
            onChange={e => setSize(Number(e.target.value))}
            unit="sq.m."
          />
          <Slider
            label="Your Price"
            min={isHomeMode ? HOME_MIN_PRICE : CITY_MIN_PRICE}
            max={isHomeMode ? HOME_MAX_PRICE : CITY_MAX_PRICE}
            value={price}
            onChange={e => setPrice(Number(e.target.value))}
            displayValue={`$${price}`}
          />
        </div>
        
        <PhotoUploader files={photos} setFiles={setPhotos} language={language} />
        
        <textarea
          placeholder="Mission details..."
          className="w-full p-4 bg-black/50 border border-white/10 rounded-2xl outline-none focus:border-[#39FF14] transition-colors placeholder:text-gray-500"
          rows={2}
          value={comment}
          onChange={e => setComment(e.target.value)}
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-5 mt-2 rounded-2xl bg-gradient-to-r from-[#39FF14] to-[#BC13FE] text-black font-black uppercase italic active:scale-95 transition-transform hover:shadow-[0_0_20px_rgba(188,19,254,0.5)]"
        >
          {isSubmitting ? <SpinnerIcon /> : "Deploy Mission 🚀"}
        </button>
      </form>
    </div>
  );
