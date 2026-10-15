/* Dueline importer: turns files, screenshots and links into plain text lines for extractTasks.
 * Pasted text never needs this file or the network. Everything here is extra:
 *  - Text formats (txt, md, csv, ics, html, rtf, json, eml) are read in the browser with no network.
 *  - Office, PDF and OCR libraries load on first use from a CDN (free, no key). OCR runs locally.
 *  - If local OCR can't load, screenshots go to the free OCR.space API instead.
 *  - Links are fetched directly, then through free public readers (allorigins.win, r.jina.ai). */
(function (root) {
  'use strict';

  const LIBS = {
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  };
  const OCR_SPACE = 'https://api.ocr.space/parse/image';
  const OCR_SPACE_KEY = 'helloworld'; // OCR.space public demo key (free, rate limited)
  const MAX_PDF_PAGES = 40, MAX_OCR_PAGES = 10;

  const loaded = {};
  function loadScript(url) {
    if (!loaded[url]) {
      loaded[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url; s.async = true;
        s.onload = resolve;
        s.onerror = () => { delete loaded[url]; reject(new Error(`Could not load ${url.split('/npm/')[1] || url} (offline?)`)); };
        document.head.appendChild(s);
      });
    }
    return loaded[url];
  }

  const ext = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const tidy = (text) => text.replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  /* ---------------- plain formats (no network) ---------------- */

  // Block elements become lines; table rows become "cell | cell | cell" so a row stays one task line.
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, svg, nav, footer, head').forEach((n) => n.remove());
    doc.querySelectorAll('tr').forEach((tr) => {
      const cells = [...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
      tr.replaceWith(doc.createTextNode(`\n${cells.join(' | ')}\n`));
    });
    doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
    doc.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, section, article, header, blockquote, pre, dt, dd, table, ul, ol')
      .forEach((n) => { n.prepend('\n'); n.append('\n'); });
    return tidy(doc.body ? doc.body.textContent : '');
  }

  function csvToText(text, sep) {
    sep = sep || (text.split('\n')[0].split('\t').length > text.split('\n')[0].split(',').length ? '\t' : ',');
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    row.push(cell); rows.push(row);
    return rows.map((r) => r.map((c) => c.trim()).filter(Boolean).join(' | ')).filter(Boolean).join('\n');
  }

  // Calendar events become "Summary on YYYY-MM-DD". Lectures without a task word are skipped later.
  function icsToText(text) {
    const unfolded = text.replace(/\r?\n[ \t]/g, '');
    const out = [];
    unfolded.split(/BEGIN:VEVENT/).slice(1).forEach((ev) => {
      const get = (k) => { const m = ev.match(new RegExp(`^${k}(?:;[^:\\n]*)?:(.*)$`, 'm')); return m ? m[1].replace(/\\[nN]/g, ' ').replace(/\\(.)/g, '$1').trim() : ''; };
      const when = get('DUE') || get('DTSTART') || get('DTEND');
      const d = when.match(/^(\d{4})(\d{2})(\d{2})/);
      const summary = get('SUMMARY');
      if (!summary) return;
      const extra = get('DESCRIPTION').slice(0, 80);
      out.push(`${summary}${d ? ` on ${d[1]}-${d[2]}-${d[3]}` : ''}${extra ? ` (${extra.replace(/[()]/g, '')})` : ''}`);
    });
    return out.join('\n');
  }

  function rtfToText(rtf) {
    return tidy(rtf
      .replace(/\\par[d]?\b/g, '\n').replace(/\\line\b/g, '\n').replace(/\\cell\b/g, ' | ').replace(/\\row\b/g, '\n')
      .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(n < 0 ? 65536 + +n : +n))
      .replace(/\{\\\*[^{}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, ''));
  }

  function jsonToText(text) {
    const lines = [];
    const walk = (v, prefix) => {
      if (Array.isArray(v)) v.forEach((x) => walk(x, prefix));
      else if (v && typeof v === 'object') {
        const flat = Object.entries(v).filter(([, x]) => x == null || typeof x !== 'object');
        if (flat.length) lines.push(flat.map(([, x]) => x).filter((x) => x != null && x !== '').join(' | '));
        Object.entries(v).filter(([, x]) => x && typeof x === 'object').forEach(([k, x]) => walk(x, k));
      } else if (v != null) lines.push(String(v));
    };
    walk(JSON.parse(text), '');
    return lines.join('\n');
  }

  function emlToText(text) {
    const split = text.split(/\r?\n\r?\n/);
    const head = split[0];
    const subject = (head.match(/^Subject:\s*(.*)$/mi) || [])[1] || '';
    let body = split.slice(1).join('\n\n');
    if (/<html|<p|<div/i.test(body)) body = htmlToText(body);
    body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return tidy(`${subject}\n${body}`);
  }

  // Last resort for old binary formats (.doc etc.): pull out runs of readable text.
  function binaryStrings(buf) {
    const bytes = new Uint8Array(buf);
    const runs = [];
    const take = (decoded) => (decoded.match(/[\x20-\x7e -ɏ\t]{4,}/g) || []).forEach((r) => { if (/[a-z]{2}/i.test(r)) runs.push(r.trim()); });
    take(new TextDecoder('latin1').decode(bytes));
    take(new TextDecoder('utf-16le').decode(bytes.slice(0, bytes.length - (bytes.length % 2))));
    return [...new Set(runs)].join('\n');
  }

  /* ---------------- office documents (JSZip, no API key) ---------------- */

  const xmlText = (el) => [...el.getElementsByTagName('*')].filter((n) => n.localName === 't' || n.localName === 'tab' || n.localName === 'br')
    .map((n) => (n.localName === 't' ? n.textContent : n.localName === 'tab' ? ' ' : '\n')).join('');

  // Word, PowerPoint and OpenDocument share one idea: paragraphs are lines, table rows are "a | b | c".
  function ooxmlToText(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const out = [];
    const visit = (node) => {
      for (const n of node.children) {
        const name = n.localName;
        if (name === 'tr' || name === 'table-row') {
          const cells = [...n.children].filter((c) => c.localName === 'tc' || c.localName === 'table-cell')
            .map((c) => (c.localName === 'tc' ? xmlText(c) : c.textContent).replace(/\s+/g, ' ').trim()).filter(Boolean);
          if (cells.length) out.push(cells.join(' | '));
        } else if (name === 'p' && n.namespaceURI && /wordprocessingml|drawingml/.test(n.namespaceURI)) {
          out.push(xmlText(n));
        } else if ((name === 'p' || name === 'h') && /opendocument/.test(n.namespaceURI || '')) {
          out.push(n.textContent);
        } else visit(n);
      }
    };
    visit(doc.documentElement);
    return out.map((l) => l.trim()).filter(Boolean).join('\n');
  }

  async function officeToText(buf, kind) {
    await loadScript(LIBS.jszip);
    const zip = await root.JSZip.loadAsync(buf);
    const read = (p) => (zip.file(p) ? zip.file(p).async('string') : '');
    if (kind === 'docx') {
      const parts = ['word/document.xml', ...Object.keys(zip.files).filter((p) => /^word\/(header|footer|footnotes)\d*\.xml$/.test(p))];
      return (await Promise.all(parts.map(read))).map((x) => (x ? ooxmlToText(x) : '')).join('\n');
    }
    if (kind === 'pptx') {
      const slides = Object.keys(zip.files).filter((p) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(p))
        .sort((a, b) => +a.match(/(\d+)\.xml$/)[1] - +b.match(/(\d+)\.xml$/)[1]);
      return (await Promise.all(slides.map(read))).map(ooxmlToText).join('\n');
    }
    return ooxmlToText(await read('content.xml')); // odt, odp
  }

  async function sheetToText(buf) {
    await loadScript(LIBS.xlsx);
    const wb = root.XLSX.read(buf, { type: 'array', cellDates: true });
    return wb.SheetNames.map((n) => {
      const rows = root.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', blankrows: false });
      return [n.match(/[A-Z]{2,5}\s?\d{3,4}/) ? n : '', ...rows.map((r) => r.map((c) => String(c).trim()).filter(Boolean).join(' | '))].filter(Boolean).join('\n');
    }).join('\n');
  }

  /* ---------------- images: local OCR (Tesseract), free OCR.space API as fallback ---------------- */

  // Upscale small screenshots and flip dark-mode screenshots to dark-on-light: both help OCR a lot.
  async function prepareImage(blob) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(3, Math.max(1, 2200 / bmp.width));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y; sum += y; }
    if (sum / (d.length / 4) < 110) for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
    g.putImageData(img, 0, 0);
    return c;
  }

  let worker = null;
  async function ocrLocal(source, progress) {
    await loadScript(LIBS.tesseract);
    if (!worker) {
      worker = root.Tesseract.createWorker('eng', 1, {
        logger: (m) => { if (m.status === 'recognizing text' && worker.onProgress) worker.onProgress(m.progress); },
      });
    }
    let w;
    try { w = await worker; } catch (e) { worker = null; throw e; }
    worker.onProgress = progress;
    const { data } = await w.recognize(source);
    return data.text;
  }

  async function ocrSpace(blob) {
    if (blob.size > 1024 * 1024) { // the free key accepts up to 1 MB
      const c = blob instanceof HTMLCanvasElement ? blob : await prepareImage(blob);
      blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
    }
    const fd = new FormData();
    fd.append('apikey', OCR_SPACE_KEY);
    fd.append('language', 'eng');
    fd.append('isTable', 'true'); // keeps table rows on one line
    fd.append('scale', 'true');
    fd.append('OCREngine', '2');
    fd.append('file', blob, blob.name || 'screenshot.png');
    const res = await fetch(OCR_SPACE, { method: 'POST', body: fd });
    const json = await res.json();
    if (json.IsErroredOnProcessing) throw new Error([].concat(json.ErrorMessage || 'OCR.space error').join(' '));
    return (json.ParsedResults || []).map((r) => r.ParsedText).join('\n').replace(/[ \t]+$/gm, '').replace(/\t+/g, ' | ');
  }

  async function imageToText(blob, progress) {
    let src;
    try { src = await prepareImage(blob); } catch (e) { src = blob; } // e.g. TIFF: let Tesseract decode it
    try {
      return { text: await ocrLocal(src, progress), method: 'OCR in your browser' };
    } catch (e) {
      progress && progress(null, 'Local OCR unavailable, trying OCR.space…');
      const blobForApi = src instanceof HTMLCanvasElement ? await new Promise((r) => src.toBlob(r, 'image/png')) : blob;
      return { text: await ocrSpace(blobForApi), method: 'OCR.space API' };
    }
  }

  /* ---------------- PDF (pdf.js; scanned pages fall back to OCR) ---------------- */

  // Rebuild lines from positioned text, and mark wide gaps as " | " so table columns stay apart.
  function pdfLines(items) {
    const rows = [];
    items.filter((it) => it.str && it.str.trim()).forEach((it) => {
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || 10;
      let row = rows.find((r) => Math.abs(r.y - y) < h * 0.5);
      if (!row) rows.push((row = { y, h, items: [] }));
      row.items.push({ x, w: it.width, s: it.str });
    });
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => {
      r.items.sort((a, b) => a.x - b.x);
      let line = '', end = null;
      r.items.forEach((it) => {
        if (end != null) { const gap = it.x - end; line += gap > r.h * 1.5 ? ' | ' : gap > r.h * 0.15 ? ' ' : ''; }
        line += it.s; end = it.x + it.w;
      });
      return line.replace(/\s+/g, ' ').trim();
    }).join('\n');
  }

  async function pdfToText(buf, progress) {
    await loadScript(LIBS.pdf);
    const lib = root.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
    const pdf = await lib.getDocument({ data: buf }).promise;
    const n = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const out = [];
    let ocrPages = 0, method = 'PDF text';
    for (let p = 1; p <= n; p++) {
      progress && progress((p - 1) / n, `Reading page ${p} of ${n}`);
      const page = await pdf.getPage(p);
      let text = pdfLines((await page.getTextContent()).items);
      if (text.replace(/\s/g, '').length < 20 && ocrPages < MAX_OCR_PAGES) { // scanned page: render it and OCR
        ocrPages++;
        const vp = page.getViewport({ scale: 2.5 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        const r = await imageToText(blob, (f) => progress && progress((p - 1 + (f || 0)) / n, `OCR page ${p} of ${n}`));
        text = r.text; method = `PDF + ${r.method}`;
      }
      out.push(text);
    }
    const note = pdf.numPages > n ? `\n(only the first ${n} of ${pdf.numPages} pages were read)` : '';
    return { text: out.join('\n') + note, method };
  }

  /* ---------------- files ---------------- */

  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif'];
  const TEXT_EXT = ['txt', 'md', 'markdown', 'text', 'log', 'tex', 'xml', 'yaml', 'yml'];

  async function fileToText(file, progress) {
    const type = (file.type || '').toLowerCase();
    const e = ext(file.name);
    if (/^(video|audio)\//.test(type) || ['mp4', 'mov', 'mkv', 'avi', 'webm', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(e)) {
      throw new Error('Video and audio are not supported');
    }
    if (type.startsWith('image/') || IMAGE_EXT.includes(e)) return imageToText(file, progress);
    if (type === 'application/pdf' || e === 'pdf') return pdfToText(await file.arrayBuffer(), progress);
    if (['docx', 'docm', 'dotx'].includes(e)) return { text: await officeToText(await file.arrayBuffer(), 'docx'), method: 'Word document' };
    if (['pptx', 'ppsx'].includes(e)) return { text: await officeToText(await file.arrayBuffer(), 'pptx'), method: 'PowerPoint slides' };
    if (['odt', 'odp'].includes(e)) return { text: await officeToText(await file.arrayBuffer(), 'odf'), method: 'OpenDocument' };
    if (['xlsx', 'xlsm', 'xls', 'ods', 'numbers'].includes(e)) return { text: await sheetToText(await file.arrayBuffer()), method: 'Spreadsheet' };
    if (['csv', 'tsv'].includes(e) || type === 'text/csv') return { text: csvToText(await file.text(), e === 'tsv' ? '\t' : null), method: 'Spreadsheet' };
    if (e === 'ics' || type === 'text/calendar') return { text: icsToText(await file.text()), method: 'Calendar' };
    if (['html', 'htm', 'xhtml', 'mht'].includes(e) || type === 'text/html') return { text: htmlToText(await file.text()), method: 'Web page' };
    if (e === 'rtf' || type.includes('rtf')) return { text: rtfToText(await file.text()), method: 'Rich text' };
    if (e === 'json' || type === 'application/json') return { text: jsonToText(await file.text()), method: 'JSON' };
    if (e === 'eml' || type === 'message/rfc822') return { text: emlToText(await file.text()), method: 'Email' };
    if (type.startsWith('text/') || TEXT_EXT.includes(e)) return { text: tidy(await file.text()), method: 'Text' };
    const buf = await file.arrayBuffer();
    const sniff = new Uint8Array(buf.slice(0, 4));
    if (sniff[0] === 0x25 && sniff[1] === 0x50) return pdfToText(buf, progress); // %PDF without .pdf
    if (sniff[0] === 0x50 && sniff[1] === 0x4b) return { text: await officeToText(buf, 'docx'), method: 'Document' }; // zip
    return { text: binaryStrings(buf), method: 'Readable text from file' };
  }

  /* ---------------- links ---------------- */

  // Shared Google files: ask for an export the parsers above understand.
  function normalizeUrl(raw) {
    let url = raw.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let m;
    if ((m = url.match(/docs\.google\.com\/document\/d\/([\w-]+)/))) return `https://docs.google.com/document/d/${m[1]}/export?format=txt`;
    if ((m = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/))) {
      const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1];
      return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
    }
    if ((m = url.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/))) return `https://docs.google.com/presentation/d/${m[1]}/export/pdf`;
    if ((m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/))) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
    return url;
  }

  const ROUTES = [
    { name: 'direct', url: (u) => u, ms: 12000 },
    { name: 'allorigins.win', url: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, ms: 12000 },
  ];

  async function fetchWithTimeout(url, ms = 20000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(t); }
  }

  async function urlToText(raw, progress) {
    const url = normalizeUrl(raw);
    const name = decodeURIComponent((new URL(url).pathname.split('/').filter(Boolean).pop() || new URL(url).hostname));
    const errors = [];
    for (const route of ROUTES) {
      try {
        progress && progress(null, route.name === 'direct' ? 'Fetching link…' : `Fetching through ${route.name}…`);
        const res = await fetchWithTimeout(route.url(url), route.ms);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!blob.size) throw new Error('empty response');
        const type = (res.headers.get('content-type') || blob.type || '').split(';')[0];
        const guessed = /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}${type.includes('html') ? '.html' : type.includes('csv') ? '.csv' : type.includes('pdf') ? '.pdf' : type.startsWith('text/') ? '.txt' : ''}`;
        const r = await fileToText(new File([blob], guessed, { type }), progress);
        if (r.text.replace(/\s/g, '').length < 10) throw new Error('no readable text');
        return { text: r.text, method: `${r.method}${route.name === 'direct' ? '' : ` via ${route.name}`}`, name };
      } catch (e) { errors.push(`${route.name}: ${e.message}`); }
    }
    try { // Jina Reader renders the page server-side (handles JS pages and PDFs) and returns text.
      progress && progress(null, 'Fetching through r.jina.ai…');
      const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, 40000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = (await res.text()).replace(/^(Title|URL Source|Published Time|Markdown Content|Warning|Number of Pages):.*$/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
      return { text: tidy(text), method: 'Web page via r.jina.ai', name };
    } catch (e) { errors.push(`r.jina.ai: ${e.message}`); }
    throw new Error(`Couldn't read that link. Is it public? (${errors.join('; ')})`);
  }

  root.DuelineImport = { fileToText, urlToText, htmlToText, csvToText, icsToText, normalizeUrl };
})(typeof self !== 'undefined' ? self : this);
