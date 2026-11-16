export function evidenceRelevant(question, article, title, text) {
  const norm = value => String(value || '').normalize('NFC').toLowerCase();
  const query = norm(question);
  const source = norm(`${title || ''} ${text || ''}`);
  const articles = Array.from(query.matchAll(/(?:^|[^\p{L}\p{N}_])điều\s+(\d+[a-z]?)(?=\s|[,.?!;:]|$)/gu), match => match[1]);
  if (articles.length && !articles.includes(norm(article))) return false;
  const machinery = ['máy tiện', 'máy móc', 'máy công cụ', 'thiết bị công nghiệp'].some(term => query.includes(term));
  const used = ['đã qua sử dụng', 'đã sử dụng', 'hàng cũ', 'máy cũ', 'tiện cũ', 'thiết bị cũ'].some(term => query.includes(term));
  if (machinery && used) {
    return ['máy móc', 'máy tiện', 'máy công cụ', 'thiết bị công nghiệp'].some(term => source.includes(term)) &&
      ['đã qua sử dụng', 'đã sử dụng', 'máy cũ', 'thiết bị cũ'].some(term => source.includes(term));
  }
  return true;
}
