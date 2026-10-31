function protect(text, pattern, stash) {
  return text.replace(pattern, (match) => {
    const token = `\u0000${stash.length}\u0000`;
    stash.push(match);
    return token;
  });
}

function restore(text, stash) {
  return text.replace(/\u0000(\d+)\u0000/g, (_match, index) => stash[Number(index)] || '');
}

function convertHeadings(text) {
  return text.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, (_match, title) => {
    const clean = String(title || '').trim().replace(/^\*+|\*+$/g, '');
    return clean ? `*${clean}*` : '';
  });
}

function convertBold(text) {
  let value = text.replace(/\*\*\*(.+?)\*\*\*/g, '*$1*');
  value = value.replace(/___(.+?)___/g, '*$1*');
  value = value.replace(/\*\*(.+?)\*\*/g, (_match, inner) => {
    const clean = String(inner).replace(/^\*+|\*+$/g, '').trim();
    return clean ? `*${clean}*` : '';
  });
  value = value.replace(/__(.+?)__/g, (_match, inner) => {
    const clean = String(inner).replace(/^_+|_+$/g, '').trim();
    return clean ? `*${clean}*` : '';
  });
  value = value.replace(/\*\*/g, '');
  return value;
}

function convertLists(text) {
  const lines = text.split('\n');
  const out = [];
  let inNumbered = false;
  let number = 1;

  for (const line of lines) {
    const heading = line.match(/^\s*\*(.+)\*\s*$/);
    const numberedOnly = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);

    if (numberedOnly) {
      if (!inNumbered) {
        if (out.length && out[out.length - 1] !== '') out.push('');
        inNumbered = true;
        number = 1;
      }
      out.push(`${number}. ${numberedOnly[2].trim()}`);
      number += 1;
      continue;
    }

    if (bullet && !heading) {
      if (inNumbered) {
        inNumbered = false;
        if (out.length && out[out.length - 1] !== '') out.push('');
      }
      out.push(`• ${bullet[1].trim()}`);
      continue;
    }

    if (inNumbered && line.trim() === '') {
      inNumbered = false;
      out.push('');
      continue;
    }
    if (inNumbered) inNumbered = false;
    out.push(line);
  }
  return out.join('\n');
}

function convertParagraphs(text) {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([^\n])\n(\*\S)/g, '$1\n\n$2')
    .replace(/(\*\S[^\n]*\*)\n([^\n*])/g, '$1\n\n$2')
    .replace(/([^\n])\n(\d+\. )/g, '$1\n\n$2')
    .replace(/([^\n])\n(• )/g, '$1\n\n$2')
    .trim();
}

export function toWhatsAppText(text) {
  let value = String(text || '');
  if (!value.trim()) return '';

  const stash = [];
  value = protect(value, /```[\s\S]*?```/g, stash);
  value = protect(value, /`[^`\n]+`/g, stash);
  value = convertHeadings(value);
  value = convertBold(value);
  value = convertLists(value);
  value = convertParagraphs(value);
  value = restore(value, stash);
  return value;
}
