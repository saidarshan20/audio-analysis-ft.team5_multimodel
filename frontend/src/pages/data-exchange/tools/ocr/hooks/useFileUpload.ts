import { useEffect, useRef, useState, ChangeEvent, DragEvent } from 'react';

export const useFileUpload = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [fileObjectUrls, setFileObjectUrls] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const newUrls: Record<string, string> = {};
    files.forEach((f: File) => {
      newUrls[f.name] = URL.createObjectURL(f);
    });
    setFileObjectUrls(newUrls);

    return () => {
      Object.values(newUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  return {
    files,
    setFiles,
    fileObjectUrls,
    fileInputRef,
    handleFileChange,
    handleDrop,
    handleDragOver,
  };
};
