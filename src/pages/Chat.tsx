import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, MessageCircle, Send } from "lucide-react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/externalClient";
import {
  buildParticipantIdentity,
  loadAdminUserIds,
  loadParticipantIdentities,
  normalizePrivateChatMessage,
  resolveConversationParticipantId,
  sendPrivateChatMessage,
  sortChatEntries,
  type ChatEntry,
  type ParticipantIdentity,
} from "@/lib/chat";

type SupportConversation = {
  avatarUrl: string | null;
  lastDate: string;
  lastMessage: string;
  pendingCount: number;
  userId: string;
  userName: string;
};

type ReportStatus = "open" | "in_review" | "warned" | "blocked" | "banned" | "dismissed";

type ChatReportEntry = {
  createdAt: string;
  id: string;
  publicMessageId: string | null;
  reason: string | null;
  reportedMessageBody: string;
  reportedMessageCreatedAt: string | null;
  reportedUserId: string;
  reporterId: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  status: ReportStatus;
};

type ChatLocationState = {
  selectedUserId?: string;
};

const REPORT_STATUS_OPTIONS: Array<{
  description: string;
  id: ReportStatus;
  label: string;
  pillClass: string;
}> = [
  {
    id: "open",
    label: "Pendente",
    description: "Denuncia nova aguardando triagem",
    pillClass: "bg-amber-100 text-amber-700",
  },
  {
    id: "in_review",
    label: "Em analise",
    description: "Caso em avaliacao pela equipe",
    pillClass: "bg-sky-100 text-sky-700",
  },
  {
    id: "warned",
    label: "Advertido",
    description: "Tratativa registrada como advertencia",
    pillClass: "bg-orange-100 text-orange-700",
  },
  {
    id: "blocked",
    label: "Bloqueado",
    description: "Tratativa registrada como bloqueio",
    pillClass: "bg-rose-100 text-rose-700",
  },
  {
    id: "banned",
    label: "Banido",
    description: "Tratativa registrada como banimento",
    pillClass: "bg-red-100 text-red-700",
  },
  {
    id: "dismissed",
    label: "Nao procede",
    description: "Caso analisado e descartado",
    pillClass: "bg-emerald-100 text-emerald-700",
  },
];

function formatConversationDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : format(date, "dd/MM HH:mm", { locale: ptBR });
}

function formatMessageTime(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : format(date, "HH:mm", { locale: ptBR });
}

function normalizeReportStatus(value: string | null | undefined): ReportStatus {
  if (value === "in_review" || value === "warned" || value === "blocked" || value === "banned" || value === "dismissed") {
    return value;
  }

  if (value === "reviewed") {
    return "in_review";
  }

  return "open";
}

function getReportStatusMeta(status: ReportStatus) {
  return REPORT_STATUS_OPTIONS.find((option) => option.id === status) ?? REPORT_STATUS_OPTIONS[0];
}

function normalizeChatReport(raw: unknown): ChatReportEntry | null {
  const row = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;

  if (!row) return null;

  const id = typeof row.id === "string" ? row.id : "";
  const reporterId = typeof row.reporter_id === "string" ? row.reporter_id : "";
  const reportedUserId = typeof row.reported_user_id === "string" ? row.reported_user_id : "";
  const reportedMessageBody = typeof row.reported_message_body === "string" ? row.reported_message_body : "";
  const createdAt = typeof row.created_at === "string" ? row.created_at : "";

  if (!id || !reporterId || !reportedUserId || !reportedMessageBody || !createdAt) return null;

  return {
    createdAt,
    id,
    publicMessageId: typeof row.public_message_id === "string" && row.public_message_id ? row.public_message_id : null,
    reason: typeof row.report_reason === "string" && row.report_reason ? row.report_reason : null,
    reportedMessageBody,
    reportedMessageCreatedAt:
      typeof row.reported_message_created_at === "string" && row.reported_message_created_at
        ? row.reported_message_created_at
        : null,
    reportedUserId,
    reporterId,
    reviewedAt: typeof row.reviewed_at === "string" && row.reviewed_at ? row.reviewed_at : null,
    reviewedBy: typeof row.reviewed_by === "string" && row.reviewed_by ? row.reviewed_by : null,
    status: normalizeReportStatus(typeof row.status === "string" ? row.status : null),
  };
}

function mergeIdentityMap(
  current: Map<string, ParticipantIdentity>,
  nextEntries: Map<string, ParticipantIdentity>,
) {
  const next = new Map(current);

  nextEntries.forEach((identity, userId) => {
    next.set(userId, identity);
  });

  return next;
}

function getRequestedUserIdFromLocation(location: ReturnType<typeof useLocation>) {
  const stateUserId = ((location.state as ChatLocationState | null)?.selectedUserId ?? "").trim();
  const searchUserId = new URLSearchParams(location.search).get("user")?.trim() ?? "";

  return searchUserId || stateUserId || null;
}

export default function Chat() {
  const location = useLocation();
  const { session } = useAuth();
  const adminId = session?.user.id ?? null;

  const [supportConversations, setSupportConversations] = useState<SupportConversation[]>([]);
  const [supportMessages, setSupportMessages] = useState<ChatEntry[]>([]);
  const [reportsQueue, setReportsQueue] = useState<ChatReportEntry[]>([]);
  const [participantIdentities, setParticipantIdentities] = useState<Map<string, ParticipantIdentity>>(new Map());
  const [selectedSupportUserId, setSelectedSupportUserId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [loadingSupportInbox, setLoadingSupportInbox] = useState(true);
  const [loadingSupportThread, setLoadingSupportThread] = useState(false);
  const [loadingReports, setLoadingReports] = useState(true);
  const [sendingReply, setSendingReply] = useState(false);
  const [updatingReportId, setUpdatingReportId] = useState<string | null>(null);
  const requestedUserId = useMemo(
    () => getRequestedUserIdFromLocation(location),
    [location.key, location.search, location.state],
  );

  const requestedUserIdRef = useRef<string | null>(
    requestedUserId,
  );
  const selectedSupportUserIdRef = useRef<string | null>(null);
  const hasLoadedSupportInboxRef = useRef(false);
  const hasLoadedSupportThreadRef = useRef(false);
  const hasLoadedReportsRef = useRef(false);

  useEffect(() => {
    selectedSupportUserIdRef.current = selectedSupportUserId;
  }, [selectedSupportUserId]);

  useEffect(() => {
    requestedUserIdRef.current = requestedUserId;

    if (!requestedUserId) {
      return;
    }

    setSelectedSupportUserId(requestedUserId);

    void loadParticipantIdentities(
      supabase,
      [requestedUserId, adminId ?? ""].filter(Boolean),
    ).then((identities) => {
      if (identities.size === 0) {
        return;
      }

      setParticipantIdentities((current) => mergeIdentityMap(current, identities));
    });
  }, [adminId, requestedUserId]);

  async function loadSupportInbox(options?: { background?: boolean }) {
    if (!adminId) return;

    const isBackground = options?.background ?? false;

    if (!isBackground || !hasLoadedSupportInboxRef.current) {
      setLoadingSupportInbox(true);
    }

    const [messagesResult, adminIds] = await Promise.all([
      supabase.from("private_chat_messages").select("*").limit(500),
      loadAdminUserIds(supabase),
    ]);

    if (messagesResult.error) {
      setLoadingSupportInbox(false);
      toast.error("Nao foi possivel carregar os atendimentos.");
      return;
    }

    const normalizedMessages = sortChatEntries(
      (messagesResult.data ?? [])
        .map((row) => normalizePrivateChatMessage(row))
        .filter((message): message is ChatEntry => Boolean(message)),
    );
    const adminUserIds = new Set(adminIds.length ? adminIds : [adminId]);
    const participantIds = Array.from(
      new Set(
        normalizedMessages
          .map((message) => resolveConversationParticipantId(message, adminUserIds, adminId))
          .filter((userId): userId is string => Boolean(userId && !adminUserIds.has(userId))),
      ),
    );
    const identities = await loadParticipantIdentities(supabase, [...participantIds, adminId]);

    setParticipantIdentities((current) => mergeIdentityMap(current, identities));

    const conversationMap = new Map<string, SupportConversation>();

    [...normalizedMessages]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .forEach((message) => {
        const userId = resolveConversationParticipantId(message, adminUserIds, adminId);

        if (!userId || adminUserIds.has(userId)) return;

        const currentConversation = conversationMap.get(userId);
        const identity = buildParticipantIdentity(userId, identities);

        if (!currentConversation) {
          conversationMap.set(userId, {
            avatarUrl: identity.avatarUrl,
            lastDate: message.createdAt,
            lastMessage: message.body,
            pendingCount: message.senderId === userId && !message.read ? 1 : 0,
            userId,
            userName: identity.name,
          });
          return;
        }

        if (message.senderId === userId && !message.read) {
          currentConversation.pendingCount += 1;
        }
      });

    const nextConversations = Array.from(conversationMap.values()).sort(
      (left, right) => new Date(right.lastDate).getTime() - new Date(left.lastDate).getTime(),
    );

    setSupportConversations(nextConversations);
    setLoadingSupportInbox(false);
    hasLoadedSupportInboxRef.current = true;

    const currentSelectedUserId = selectedSupportUserIdRef.current;
    const requestedUserId = requestedUserIdRef.current;

    if (requestedUserId) {
      requestedUserIdRef.current = null;

      if (currentSelectedUserId !== requestedUserId) {
        setSelectedSupportUserId(requestedUserId);
      }
      return;
    }

  }

  async function loadSupportThread(userId: string, options?: { background?: boolean }) {
    if (!adminId) return;

    const isBackground = options?.background ?? false;

    if (!isBackground || !hasLoadedSupportThreadRef.current) {
      setLoadingSupportThread(true);
    }

    const messagesResult = await supabase
      .from("private_chat_messages")
      .select("*")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .limit(300);

    if (messagesResult.error) {
      setLoadingSupportThread(false);
      toast.error("Nao foi possivel carregar o atendimento selecionado.");
      return;
    }

    const normalizedMessages = sortChatEntries(
      (messagesResult.data ?? [])
        .map((row) => normalizePrivateChatMessage(row))
        .filter((message): message is ChatEntry => Boolean(message)),
    );

    const identities = await loadParticipantIdentities(
      supabase,
      [
        ...normalizedMessages.flatMap((message) => [message.senderId, message.receiverId ?? ""]).filter(Boolean),
        userId,
        adminId,
      ],
    );

    setParticipantIdentities((current) => mergeIdentityMap(current, identities));
    setSupportMessages(normalizedMessages);
    setLoadingSupportThread(false);
    hasLoadedSupportThreadRef.current = true;

    const unreadIds = normalizedMessages
      .filter((message) => message.senderId === userId && !message.read && message.receiverId === adminId)
      .map((message) => message.id);

    if (unreadIds.length) {
      await supabase.from("private_chat_messages").update({ read: true }).in("id", unreadIds);

      setSupportMessages((current) =>
        current.map((message) => (unreadIds.includes(message.id) ? { ...message, read: true } : message)),
      );
      void loadSupportInbox({ background: true });
    }
  }

  async function loadReportsQueue(options?: { background?: boolean }) {
    if (!adminId) return;

    const isBackground = options?.background ?? false;

    if (!isBackground || !hasLoadedReportsRef.current) {
      setLoadingReports(true);
    }

    const reportsResult = await supabase
      .from("chat_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (reportsResult.error) {
      setLoadingReports(false);
      toast.error("Nao foi possivel carregar a fila de denuncias.");
      return;
    }

    const normalizedReports = (reportsResult.data ?? [])
      .map((row) => normalizeChatReport(row))
      .filter((report): report is ChatReportEntry => Boolean(report));
    const identities = await loadParticipantIdentities(
      supabase,
      [
        ...normalizedReports.flatMap((report) => [report.reportedUserId, report.reporterId]),
        adminId,
      ].filter(Boolean),
    );

    setParticipantIdentities((current) => mergeIdentityMap(current, identities));
    setReportsQueue(normalizedReports);
    setLoadingReports(false);
    hasLoadedReportsRef.current = true;

    setSelectedReportId((current) => {
      if (current && normalizedReports.some((report) => report.id === current)) {
        return current;
      }

      return normalizedReports[0]?.id ?? null;
    });
  }

  async function handleSendReply() {
    if (!adminId || !selectedSupportUserId || !reply.trim() || sendingReply) return;

    setSendingReply(true);
    const errorMessage = await sendPrivateChatMessage(
      supabase,
      adminId,
      selectedSupportUserId,
      reply.trim(),
    );
    setSendingReply(false);

    if (errorMessage) {
      toast.error("Nao foi possivel enviar a resposta.");
      return;
    }

    setReply("");
    void loadSupportInbox({ background: true });
    void loadSupportThread(selectedSupportUserId, { background: true });
  }

  async function handleUpdateReportStatus(reportId: string, nextStatus: ReportStatus) {
    if (!adminId || updatingReportId === reportId) return;

    const now = new Date().toISOString();
    const nextReviewedAt = nextStatus === "open" ? null : now;
    const nextReviewedBy = nextStatus === "open" ? null : adminId;

    setUpdatingReportId(reportId);

    const { error } = await supabase
      .from("chat_reports")
      .update({
        reviewed_at: nextReviewedAt,
        reviewed_by: nextReviewedBy,
        status: nextStatus,
      })
      .eq("id", reportId);

    setUpdatingReportId(null);

    if (error) {
      toast.error("Nao foi possivel atualizar a tratativa da denuncia.");
      return;
    }

    setReportsQueue((current) =>
      current.map((report) =>
        report.id === reportId
          ? {
              ...report,
              reviewedAt: nextReviewedAt,
              reviewedBy: nextReviewedBy,
              status: nextStatus,
            }
          : report,
      ),
    );

    toast.success("Tratativa da denuncia atualizada.");
  }

  useEffect(() => {
    if (!adminId) return;

    void loadSupportInbox();
    void loadReportsQueue();

    const channel = supabase
      .channel(`backoffice-chat:${adminId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "private_chat_messages" }, () => {
        void loadSupportInbox({ background: true });

        if (selectedSupportUserIdRef.current) {
          void loadSupportThread(selectedSupportUserIdRef.current, { background: true });
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "private_chat_messages" }, () => {
        void loadSupportInbox({ background: true });

        if (selectedSupportUserIdRef.current) {
          void loadSupportThread(selectedSupportUserIdRef.current, { background: true });
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_reports" }, () => {
        void loadReportsQueue({ background: true });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_reports" }, () => {
        void loadReportsQueue({ background: true });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [adminId]);

  useEffect(() => {
    if (!adminId || !selectedSupportUserId) {
      setSupportMessages([]);
      return;
    }

    void loadSupportThread(selectedSupportUserId);
  }, [adminId, selectedSupportUserId]);

  const selectedSupportConversation = useMemo(
    () => supportConversations.find((conversation) => conversation.userId === selectedSupportUserId) ?? null,
    [selectedSupportUserId, supportConversations],
  );
  const selectedSupportIdentity = useMemo(
    () => (selectedSupportUserId ? buildParticipantIdentity(selectedSupportUserId, participantIdentities) : null),
    [participantIdentities, selectedSupportUserId],
  );

  const selectedReport = useMemo(
    () => reportsQueue.find((report) => report.id === selectedReportId) ?? null,
    [reportsQueue, selectedReportId],
  );

  const pendingReportsCount = useMemo(
    () => reportsQueue.filter((report) => report.status === "open" || report.status === "in_review").length,
    [reportsQueue],
  );

  return (
    <>
      <PageHeader
        title="Chat"
        description="Atendimento privado e fila unica de denuncias do chat publico"
      />

      <Tabs className="space-y-6" defaultValue="support">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="support">Suporte</TabsTrigger>
          <TabsTrigger value="reports">Denuncias</TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-6" value="support">
          <div className="grid h-[calc(100vh-14rem)] min-h-0 grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="min-h-0 overflow-hidden lg:col-span-1">
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="text-sm">Atendimentos privados</CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 p-0">
                <ScrollArea className="h-[500px] lg:h-[calc(100vh-18.5rem)]">
                  {loadingSupportInbox ? (
                    <p className="p-4 text-sm text-muted-foreground">Carregando atendimentos...</p>
                  ) : supportConversations.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">Nenhum atendimento iniciado.</p>
                  ) : (
                    supportConversations.map((conversation) => (
                      <button
                        className={`flex w-full items-start border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/40 ${
                          selectedSupportUserId === conversation.userId ? "bg-muted/60" : ""
                        }`}
                        key={conversation.userId}
                        onClick={() => setSelectedSupportUserId(conversation.userId)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{conversation.userName}</p>
                              <p className="truncate text-xs text-muted-foreground">{conversation.lastMessage}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-muted-foreground">
                                {formatConversationDate(conversation.lastDate)}
                              </p>
                              {conversation.pendingCount > 0 ? (
                                <span className="mt-1 inline-flex min-w-5 justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                                  {conversation.pendingCount}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="flex min-h-0 flex-col overflow-hidden lg:col-span-2">
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="text-sm">
                  {selectedSupportUserId ? (
                    <div>
                      <p className="text-sm font-semibold">
                        Conversa com {selectedSupportConversation?.userName ?? selectedSupportIdentity?.name ?? "Participante"}
                      </p>
                      <p className="text-xs font-normal text-muted-foreground">
                        {selectedSupportConversation
                          ? "Atendimento privado da operacao"
                          : "Atendimento aberto a partir da selecao do participante"}
                      </p>
                    </div>
                  ) : (
                    "Selecione um atendimento"
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                <div className="min-h-0 flex-1">
                  <ScrollArea className="h-full p-4">
                    {!selectedSupportUserId ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        <div className="space-y-2 text-center">
                          <MessageCircle className="mx-auto h-8 w-8" />
                          <p>Escolha um atendimento para responder.</p>
                        </div>
                      </div>
                    ) : loadingSupportThread ? (
                      <p className="text-sm text-muted-foreground">Carregando mensagens...</p>
                    ) : supportMessages.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma mensagem neste atendimento ainda.</p>
                    ) : (
                      supportMessages.map((message) => {
                        const isAdminMessage = message.senderId === adminId;
                        const identity = isAdminMessage
                          ? { avatarUrl: null, name: "Equipe" }
                          : buildParticipantIdentity(message.senderId, participantIdentities);

                        return (
                          <div
                            className={`mb-4 flex ${isAdminMessage ? "justify-end" : "justify-start"}`}
                            key={message.id}
                          >
                            <div className={`flex max-w-[78%] flex-col ${isAdminMessage ? "items-end" : "items-start"}`}>
                              <div
                                className={`rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                                  isAdminMessage
                                    ? "bg-primary text-primary-foreground"
                                    : "border border-border/60 bg-muted/45 text-foreground"
                                }`}
                              >
                                <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-medium opacity-80">
                                  <span>{identity.name}</span>
                                  <span>{formatMessageTime(message.createdAt)}</span>
                                </div>
                                <p className="whitespace-pre-wrap">{message.body}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </ScrollArea>
                </div>
                {selectedSupportUserId ? (
                  <div className="border-t border-border p-4">
                    <div className="flex gap-2">
                      <Input
                        onChange={(event) => setReply(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && void handleSendReply()}
                        placeholder="Digite sua resposta..."
                        value={reply}
                      />
                      <Button
                        disabled={!reply.trim() || sendingReply}
                        onClick={() => void handleSendReply()}
                        size="icon"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent className="space-y-6" value="reports">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.95fr)]">
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-border pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm">Fila unica de denuncias</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Todas as denuncias do chat publico aparecem aqui para triagem.
                    </p>
                  </div>
                  <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {pendingReportsCount} pendentes
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingReports ? (
                  <p className="p-4 text-sm text-muted-foreground">Carregando denuncias...</p>
                ) : reportsQueue.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">Nenhuma denuncia registrada.</p>
                ) : (
                  <ScrollArea className="h-[560px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Denunciado</TableHead>
                          <TableHead>Denunciante</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Quando</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reportsQueue.map((report) => {
                          const statusMeta = getReportStatusMeta(report.status);
                          const reportedIdentity = buildParticipantIdentity(report.reportedUserId, participantIdentities);
                          const reporterIdentity = buildParticipantIdentity(report.reporterId, participantIdentities);
                          const isSelected = selectedReportId === report.id;

                          return (
                            <TableRow
                              className={`cursor-pointer ${isSelected ? "bg-muted/50" : ""}`}
                              key={report.id}
                              onClick={() => setSelectedReportId(report.id)}
                            >
                              <TableCell className="font-mono text-xs">{report.id.slice(0, 8)}</TableCell>
                              <TableCell className="max-w-[180px]">
                                <div className="truncate font-medium">{reportedIdentity.name}</div>
                              </TableCell>
                              <TableCell className="max-w-[180px]">
                                <div className="truncate text-sm">{reporterIdentity.name}</div>
                              </TableCell>
                              <TableCell>
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusMeta.pillClass}`}>
                                  {statusMeta.label}
                                </span>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {formatConversationDate(report.createdAt)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="text-sm">
                  {selectedReport ? "Detalhes da denuncia" : "Selecione uma denuncia"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 p-5">
                {!selectedReport ? (
                  <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                    Escolha uma denuncia na tabela para analisar.
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Protocolo
                        </p>
                        <p className="mt-1 font-mono text-sm text-foreground">{selectedReport.id}</p>
                      </div>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                          getReportStatusMeta(selectedReport.status).pillClass
                        }`}
                      >
                        {getReportStatusMeta(selectedReport.status).label}
                      </span>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-xl border border-border/70 bg-muted/25 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Denunciado
                        </p>
                        <p className="mt-2 text-sm font-semibold text-foreground">
                          {buildParticipantIdentity(selectedReport.reportedUserId, participantIdentities).name}
                        </p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {selectedReport.reportedUserId}
                        </p>
                      </div>

                      <div className="rounded-xl border border-border/70 bg-muted/25 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Denunciante
                        </p>
                        <p className="mt-2 text-sm font-semibold text-foreground">
                          {buildParticipantIdentity(selectedReport.reporterId, participantIdentities).name}
                        </p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {selectedReport.reporterId}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Mensagem denunciada
                      </p>
                      <div className="rounded-xl border border-amber-400/40 bg-amber-50/10 p-4 text-sm text-foreground">
                        <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-amber-600">
                          <AlertTriangle className="h-4 w-4" />
                          Registro do chat publico
                        </div>
                        <p className="whitespace-pre-wrap">{selectedReport.reportedMessageBody}</p>
                      </div>
                      {selectedReport.reportedMessageCreatedAt ? (
                        <p className="text-xs text-muted-foreground">
                          Mensagem enviada em {formatConversationDate(selectedReport.reportedMessageCreatedAt)}
                        </p>
                      ) : null}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Status da tratativa
                        </p>
                        <Select
                          disabled={updatingReportId === selectedReport.id}
                          onValueChange={(value) => void handleUpdateReportStatus(selectedReport.id, value as ReportStatus)}
                          value={selectedReport.status}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Escolha o status" />
                          </SelectTrigger>
                          <SelectContent>
                            {REPORT_STATUS_OPTIONS.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {getReportStatusMeta(selectedReport.status).description}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Metadados
                        </p>
                        <div className="rounded-xl border border-border/70 bg-muted/25 p-4 text-xs text-muted-foreground">
                          <p>Registrada em {formatConversationDate(selectedReport.createdAt)}</p>
                          <p className="mt-2">
                            {selectedReport.reviewedAt
                              ? `Ultima tratativa em ${formatConversationDate(selectedReport.reviewedAt)}`
                              : "Sem tratativa registrada ainda"}
                          </p>
                          <p className="mt-2 font-mono">
                            Mensagem publica: {selectedReport.publicMessageId ?? "sem referencia"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {selectedReport.reason ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Observacao do denunciante
                        </p>
                        <div className="rounded-xl border border-border/70 bg-muted/25 p-4 text-sm text-foreground">
                          <p className="whitespace-pre-wrap">{selectedReport.reason}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/70 bg-muted/15 p-4 text-sm text-muted-foreground">
                        O denunciante nao adicionou observacao complementar.
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
