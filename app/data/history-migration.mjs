export function migrateLegacySessions(sessions) {
  return sessions.map(session => ({
    ...session,
    status: session.status === 'refunded' ? 'draft' : session.status,
    messages: Array.isArray(session.messages) ? session.messages.map(message => {
      if (message.role !== 'assistant' || !message.onchain) return message;
      return { ...message, legacyOnchain: message.onchain, onchain: undefined,
        feeLabel: 'Dữ liệu phiên bản trước — chưa xác minh giao dịch' };
    }) : []
  }));
}
