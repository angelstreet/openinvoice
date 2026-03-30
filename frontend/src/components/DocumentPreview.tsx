import { useMemo } from 'react';
import { t } from '../i18n';
import type { Lang } from '../i18n';

interface DocumentPreviewProps {
  lang: Lang;
  // From a File object (demo upload flow)
  file?: File;
  // From a URL (history detail flow)
  fileUrl?: string;
  filename?: string;
  contentType?: string;
}

export default function DocumentPreview({ file, fileUrl, filename, contentType, lang }: DocumentPreviewProps) {
  const url = useMemo(() => {
    if (fileUrl) return fileUrl;
    if (file) return URL.createObjectURL(file);
    return null;
  }, [file, fileUrl]);

  const displayName = file?.name ?? filename ?? 'Document';
  const sizeKb = file ? `${(file.size / 1024).toFixed(0)} KB` : null;

  const isPdf = file
    ? file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    : contentType === 'application/pdf' || displayName.toLowerCase().endsWith('.pdf');

  if (!url) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
        <h3 className="text-sm font-medium text-slate-700 truncate">
          {displayName}
        </h3>
        {sizeKb && (
          <p className="text-xs text-slate-500 mt-0.5">{sizeKb}</p>
        )}
      </div>
      <div className="flex-1 min-h-0 p-2 bg-slate-100 flex items-center justify-center">
        {isPdf ? (
          <object
            data={url}
            type="application/pdf"
            className="w-full h-full min-h-[500px] rounded"
          >
            <div className="text-center text-slate-500 py-12">
              <p className="text-sm">PDF preview not available in this browser.</p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline text-sm mt-2 inline-block"
              >
                Open PDF in new tab
              </a>
            </div>
          </object>
        ) : (
          <img
            src={url}
            alt={t(lang, 'preview')}
            className="max-w-full max-h-[600px] object-contain rounded"
          />
        )}
      </div>
    </div>
  );
}
