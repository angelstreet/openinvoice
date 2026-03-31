import { useMemo, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { t } from '../i18n';
import type { Lang } from '../i18n';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface DocumentPreviewProps {
  lang: Lang;
  file?: File;
  fileUrl?: string;
  filename?: string;
  contentType?: string;
}

function PdfCanvas({ file, fileUrl }: { file?: File; fileUrl?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    async function render() {
      try {
        setLoading(true);
        setError(null);

        // Get PDF data as ArrayBuffer (avoids blob URL issues in iframes)
        let source: { data: ArrayBuffer } | { url: string };
        if (file) {
          const buffer = await file.arrayBuffer();
          source = { data: buffer };
        } else if (fileUrl) {
          // For API URLs, fetch with credentials then use ArrayBuffer
          const resp = await fetch(fileUrl);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buffer = await resp.arrayBuffer();
          source = { data: buffer };
        } else {
          return;
        }

        const pdf = await pdfjsLib.getDocument(source).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);

        container!.innerHTML = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          if (cancelled) return;

          const containerWidth = container!.clientWidth || 400;
          const scale = containerWidth / page.getViewport({ scale: 1 }).width;
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
      } catch (e: any) {
        if (!cancelled) {
          console.error('PDF render error:', e);
          setError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    render();
    return () => { cancelled = true; };
  }, [file, fileUrl]);

  if (error) {
    return (
      <div className="text-center text-slate-500 py-12">
        <p className="text-sm">PDF preview failed</p>
        <p className="text-xs text-slate-400 mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div>
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-600" />
        </div>
      )}
      <div ref={containerRef} className="w-full" />
      {pageCount > 0 && (
        <p className="text-xs text-slate-400 text-center mt-2">{pageCount} page{pageCount > 1 ? 's' : ''}</p>
      )}
    </div>
  );
}

export default function DocumentPreview({ file, fileUrl, filename, contentType, lang }: DocumentPreviewProps) {
  const displayName = file?.name ?? filename ?? 'Document';
  const sizeKb = file ? `${(file.size / 1024).toFixed(0)} KB` : null;

  const isPdf = file
    ? file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    : contentType === 'application/pdf' || displayName.toLowerCase().endsWith('.pdf');

  const imageUrl = useMemo(() => {
    if (!isPdf) {
      if (fileUrl) return fileUrl;
      if (file) return URL.createObjectURL(file);
    }
    return null;
  }, [file, fileUrl, isPdf]);

  if (!file && !fileUrl) return null;

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
          <PdfCanvas file={file} fileUrl={fileUrl} />
        ) : (
          <img
            src={imageUrl!}
            alt={t(lang, 'preview')}
            className="max-w-full max-h-[600px] object-contain rounded mx-auto"
          />
        )}
      </div>
    </div>
  );
}
