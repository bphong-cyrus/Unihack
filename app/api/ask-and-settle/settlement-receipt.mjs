/** A submitted hash alone does not establish that a transaction succeeded. */
export async function confirmedReceipt(client, hash) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt?.status !== 'success' ||
      String(receipt.transactionHash || '').toLowerCase() !== String(hash).toLowerCase()) {
    throw new Error('Transaction was not confirmed successfully');
  }
  return receipt;
}
