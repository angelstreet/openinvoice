import { useMemo, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { t } from '../i18n';
import type { Lang } from '../i18n';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface DocumentPreviewProps {
  lang: Lang;
  file?: File;
  fileUrl?: string;
  filename?: string;
  contentType?: string;
}

function PdfCanvas({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    async function render() {
      try {
        const pdf = await pdfjsLib.getDocument(url).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);

        // Clear previous canvases
        container!.innerHTML = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (cancelled) return;

          const scale = container!.clientWidth / page.getViewport({ scale: 1 }).width;
          const viewport = page.getViewport({ scale: Math.min(scale, 2) });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.display = 'block';
          if (i > 1) canvas.style.marginTop = '8px';

          container!.appendChild(canvas);

          await page.render({
            canvasContext: canvas.getContext('2d')!,
            viewport,
          } as any).promise;
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }

    render();
    return () => { cancelled = true; };
  }, [url]);

  if (error) {
    return (
      <div className="text-center text-slate-500 py-12">
        <p className="text-sm">Failed to render PDF.</p>
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="text-blue-600 underline text-sm mt-2 inline-block">
          Open PDF in new tab
        </a>
      </div>
    );
  }

  return (
    <div>
      <div ref={containerRef} className="w-full" />
      {pageCount > 0 && (
        <p className="text-xs text-slate-400 text-center mt-2">{pageCount} page{pageCount > 1 ? 's' : ''}</p>
      )}
    </div>
  );
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
      <div className="flex-1 min-h-0 p-2 bg-slate-100 overflow-y-auto">
        {isPdf ? (
          <PdfCanvas url={url} />
        ) : (
          <img
            src={url}
            alt={t(lang, 'preview')}
            className="max-w-full max-h-[600px] object-contain rounded mx-auto"
          />
        )}
      </div>
    </div>
  );
}
