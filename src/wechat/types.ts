export type InboundWeChatMessage = {
  fromUserId: string;
  text: string;
  contextToken: string;
  clientId?: string;
  imageUrls?: string[];
};
