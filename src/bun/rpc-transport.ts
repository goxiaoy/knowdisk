const MISSING_RPC_SEND_TRANSPORT_ERROR =
  'This RPC instance cannot send messages because the transport did not provide one or more of these methods: "send"';

export function isMissingRpcSendTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(MISSING_RPC_SEND_TRANSPORT_ERROR);
}
