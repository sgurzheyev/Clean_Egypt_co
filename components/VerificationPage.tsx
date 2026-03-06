import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

const BUCKET_VERIFICATIONS = 'verifications';

const VerificationPage: React.FC = () => {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setSubmitError(null);
      const url = URL.createObjectURL(file);
      setPhotoPreview(url);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!fullName.trim()) return;
    if (!photoFile) {
      setSubmitError('Загрузите фото документа (ID или паспорт).');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSubmitError('Войдите в аккаунт, чтобы отправить заявку.');
      return;
    }

    setIsSubmitting(true);
    try {
      const ext = photoFile.name.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${user.id}_${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_VERIFICATIONS)
        .upload(fileName, photoFile, {
          contentType: photoFile.type || 'image/jpeg',
          upsert: false,
        });

      if (uploadError) {
        console.error('Storage upload error:', uploadError);
        setSubmitError('Не удалось загрузить фото. Проверьте размер и формат или попробуйте позже.');
        return;
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          verification_status: 'pending',
          verification_photo_path: fileName,
        })
        .eq('id', user.id);

      if (updateError) {
        console.error('Profile update error:', updateError);
        setSubmitError('Фото загружено, но не удалось обновить профиль. Обратитесь в поддержку.');
        return;
      }

      setSubmitted(true);
    } catch (err) {
      console.error('Verification submit error:', err);
      setSubmitError('Ошибка отправки. Попробуйте позже.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-md font-sans ltr">
      <div className="min-h-full py-8 px-4 flex flex-col items-center">
        <div className="w-full max-w-md">
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="mb-6 text-slate-400 hover:text-white text-sm font-bold flex items-center gap-2 transition-colors"
          >
            ← Назад в профиль
          </button>

          <div className="bg-slate-800/90 backdrop-blur-sm border border-white/10 rounded-3xl p-6 shadow-2xl">
            <h1 className="text-2xl font-black text-white mb-1 tracking-tight">
              Верификация рабочего
            </h1>
            <p className="text-slate-400 text-sm mb-6">
              Нужна для доступа к домашним миссиям (CleanMyHome).
            </p>

            {submitted ? (
              <div className="py-8 text-center">
                <p className="text-emerald-400 font-bold text-lg mb-2">
                  Заявка отправлена
                </p>
                <p className="text-slate-400 text-sm mb-6">
                  Мы проверим документ и обновим статус в профиле.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/profile')}
                  className="w-full py-3 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-900 font-black text-sm transition-colors"
                >
                  В профиль
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">
                    ФИО
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Иван Иванов"
                    className="w-full bg-slate-900/80 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:border-teal-400/50 outline-none transition-colors"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">
                    Фото документа (ID / паспорт)
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-4 rounded-xl border-2 border-dashed border-white/20 hover:border-teal-400/50 bg-slate-900/50 text-slate-400 hover:text-teal-400 transition-all flex flex-col items-center justify-center gap-2"
                  >
                    {photoPreview ? (
                      <>
                        <img
                          src={photoPreview}
                          alt="Preview"
                          className="max-h-24 rounded-lg object-cover"
                        />
                        <span className="text-xs font-bold">Изменить фото</span>
                      </>
                    ) : (
                      <>
                        <span className="text-2xl">📄</span>
                        <span className="text-sm font-bold">Нажмите для загрузки</span>
                      </>
                    )}
                  </button>
                </div>

                {submitError && (
                  <p className="text-red-400 text-sm font-medium" role="alert">
                    {submitError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-teal-400 to-cyan-400 text-slate-900 font-black text-sm uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Отправка...' : 'Отправить на проверку'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerificationPage;
