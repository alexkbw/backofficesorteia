type RawRecord = Record<string, unknown>;

type SupabaseLikeClient = {
  from: (table: string) => any;
  rpc?: (fn: string, args?: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown }>;
};

export type ChatEntry = {
  body: string;
  createdAt: string;
  id: string;
  read: boolean;
  receiverId: string | null;
  senderId: string;
};

export type ParticipantIdentity = {
  avatarUrl: string | null;
  name: string;
};

function asRecord(value: unknown): RawRecord | null {
  return typeof value === "object" && value !== null ? (value as RawRecord) : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function readTimestamp(row: RawRecord) {
  return readString(row.sent_at) || readString(row.created_at) || new Date(0).toISOString();
}

function shouldRetryLegacyChatInsert(error: { message?: string | null } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();

  return (
    message.includes("could not find the 'message' column") ||
    message.includes("could not find the 'user_id' column") ||
    message.includes("could not find the 'content' column") ||
    message.includes("could not find the 'sender_id' column") ||
    message.includes("null value in column \"sender_id\"") ||
    message.includes("null value in column \"content\"") ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

function buildFallbackParticipantLabel(userId: string) {
  return userId ? `Participante ${userId.slice(0, 8)}` : "Participante";
}

export function normalizePublicChatMessage(raw: unknown): ChatEntry | null {
  const row = asRecord(raw);

  if (!row) return null;

  const id = readString(row.id);
  const senderId = readString(row.user_id) || readString(row.sender_id);
  const body = readString(row.message) || readString(row.content);

  if (!id || !senderId || !body) return null;

  return {
    body,
    createdAt: readTimestamp(row),
    id,
    read: true,
    receiverId: null,
    senderId,
  };
}

export function normalizePrivateChatMessage(raw: unknown): ChatEntry | null {
  const row = asRecord(raw);

  if (!row) return null;

  const id = readString(row.id);
  const senderId = readString(row.sender_id);
  const receiverId = readNullableString(row.receiver_id);
  const body = readString(row.message) || readString(row.content);

  if (!id || !senderId || !body) return null;

  return {
    body,
    createdAt: readTimestamp(row),
    id,
    read: readBoolean(row.read),
    receiverId,
    senderId,
  };
}

export function sortChatEntries(entries: ChatEntry[]) {
  return [...entries].sort((left, right) => {
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
}

export function mergeChatEntries(entries: ChatEntry[], nextEntries: ChatEntry[]) {
  const map = new Map(entries.map((entry) => [entry.id, entry]));

  nextEntries.forEach((entry) => {
    map.set(entry.id, entry);
  });

  return sortChatEntries(Array.from(map.values()));
}

export function buildParticipantLabel(userId: string, profileNames: Map<string, string>) {
  return profileNames.get(userId) ?? buildFallbackParticipantLabel(userId);
}

export function buildParticipantIdentity(
  userId: string,
  identities: Map<string, ParticipantIdentity>,
) {
  return identities.get(userId) ?? { avatarUrl: null, name: buildFallbackParticipantLabel(userId) };
}

export function resolveConversationParticipantId(
  message: ChatEntry,
  adminUserIds: Set<string>,
  currentAdminId?: string | null,
) {
  if (message.senderId === message.receiverId) {
    return message.senderId;
  }

  const senderIsAdmin = adminUserIds.has(message.senderId);
  const receiverIsAdmin = Boolean(message.receiverId && adminUserIds.has(message.receiverId));

  if (senderIsAdmin && !receiverIsAdmin) {
    return message.receiverId;
  }

  if (receiverIsAdmin && !senderIsAdmin) {
    return message.senderId;
  }

  if (currentAdminId && message.senderId === currentAdminId) {
    return message.receiverId;
  }

  if (currentAdminId && message.receiverId === currentAdminId) {
    return message.senderId;
  }

  return message.senderId;
}

export async function loadProfileNames(supabase: SupabaseLikeClient, userIds: string[]) {
  const identities = await loadParticipantIdentities(supabase, userIds);

  return Array.from(identities.entries()).reduce((map, [userId, identity]) => {
    map.set(userId, identity.name);
    return map;
  }, new Map<string, string>());
}

export async function loadParticipantIdentities(supabase: SupabaseLikeClient, userIds: string[]) {
  if (!userIds.length) return new Map<string, ParticipantIdentity>();

  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const { data, error } = await supabase.from("profiles").select("*").in("user_id", uniqueUserIds);

  if (error || !Array.isArray(data)) {
    return new Map<string, ParticipantIdentity>();
  }

  return data.reduce((map: Map<string, ParticipantIdentity>, row: unknown) => {
    const record = asRecord(row);

    if (!record) return map;

    const userId = readString(record.user_id);
    const displayName = readString(record.display_name) || readString(record.full_name);
    const email = readString(record.email);
    const fallbackName = email ? email.split("@")[0] : "";
    const name = displayName || fallbackName;

    if (userId && name) {
      map.set(userId, {
        avatarUrl: readNullableString(record.avatar_url),
        name,
      });
    }

    return map;
  }, new Map<string, ParticipantIdentity>());
}

export async function loadAdminUserIds(supabase: SupabaseLikeClient) {
  const { data, error } = await supabase.from("user_roles").select("user_id, role").eq("role", "admin");

  if (error || !Array.isArray(data)) {
    return [];
  }

  return Array.from(
    new Set(
      data
        .map((row: unknown) => readString(asRecord(row)?.user_id))
        .filter((userId): userId is string => Boolean(userId)),
    ),
  );
}

export async function resolveSupportReceiverId(supabase: SupabaseLikeClient, currentUserId: string) {
  const supportAdminResult = await supabase.rpc?.("get_support_admin_user_id");
  const supportAdminId = typeof supportAdminResult?.data === "string" ? supportAdminResult.data : null;

  if (supportAdminId && supportAdminId !== currentUserId) {
    return supportAdminId;
  }

  const adminUserIds = await loadAdminUserIds(supabase);

  return adminUserIds.find((userId) => userId !== currentUserId) ?? currentUserId;
}

export async function sendPublicChatMessage(
  supabase: SupabaseLikeClient,
  senderId: string,
  body: string,
) {
  const firstAttempt = await supabase
    .from("public_chat_messages")
    .insert({ message: body, user_id: senderId });

  if (!firstAttempt.error) return null;
  if (!shouldRetryLegacyChatInsert(firstAttempt.error)) {
    return firstAttempt.error.message ?? "Erro ao enviar mensagem.";
  }

  const fallbackAttempt = await supabase
    .from("public_chat_messages")
    .insert({ content: body, sender_id: senderId });

  return fallbackAttempt.error?.message ?? firstAttempt.error.message ?? "Erro ao enviar mensagem.";
}

export async function sendPrivateChatMessage(
  supabase: SupabaseLikeClient,
  senderId: string,
  receiverId: string,
  body: string,
) {
  const firstAttempt = await supabase
    .from("private_chat_messages")
    .insert({ message: body, receiver_id: receiverId, sender_id: senderId });

  if (!firstAttempt.error) return null;
  if (!shouldRetryLegacyChatInsert(firstAttempt.error)) {
    return firstAttempt.error.message ?? "Erro ao enviar mensagem.";
  }

  const fallbackAttempt = await supabase
    .from("private_chat_messages")
    .insert({ content: body, receiver_id: receiverId, sender_id: senderId });

  return fallbackAttempt.error?.message ?? firstAttempt.error.message ?? "Erro ao enviar mensagem.";
}
