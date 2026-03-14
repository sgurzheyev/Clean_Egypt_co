import React, { useState } from 'react';
import { supabase } from '../lib/supabase'; // Убедись, что путь к твоему клиенту верный

interface Props {
  pyramidId: string;
  onSuccess?: () => void;
}

export const WorkResultUploader: React.FC<Props> = ({ pyramidId, onSuccess }) => {
  const [loading, setLoading] = useState(false);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setLoading(true);
      const file = event.target.files?.[0];
      if (!file) return;

      // 1. Загрузка в Storage (бакет order-photos) — safe filename, no original file.name in path
      const rawExt = file.name.split('.').pop() || 'jpg';
      const fileExt = rawExt.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
      const fileName = `mission_${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('order-photos')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // 2. Получение ссылки
      const { data: { publicUrl } } = supabase.storage
        .from('order-photos')
        .getPublicUrl(fileName);

      // 3. Обновление базы (те колонки, что мы только что создали)
      const { error: updateError } = await supabase
        .from('pyramids')
        .update({
          photo_after_url: publicUrl,
          status: 'verifying' // Меняем статус для Ахмеда
        })
        .eq('id', pyramidId);

      if (updateError) throw updateError;

      alert("Красава! Фото загружено. Ждем проверку Ахмедом.");
      if (onSuccess) onSuccess();

    } catch (error: any) {
      alert("Ошибка: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 p-4 border-2 border-dashed border-cyan-400 rounded-lg">
      <h3 className="text-white font-bold">ЗАГРУЗИТЬ ФОТО «ПОСЛЕ»</h3>
      <input
        type="file"
        accept="image/*"
        onChange={handleUpload}
        disabled={loading}
        className="text-sm text-cyan-100 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyan-500 file:text-white hover:file:bg-cyan-600 cursor-pointer"
      />
      {loading && <p className="text-cyan-400 animate-pulse">Загрузка на сервер...</p>}
    </div>
  );
};
