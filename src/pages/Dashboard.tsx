import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "react-router-dom";
import { ArrowRight, Clock3, CreditCard, MessageCircle, Trophy, TrendingUp, Users } from "lucide-react";

import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/externalClient";
import {
  buildParticipantIdentity,
  loadAdminUserIds,
  loadParticipantIdentities,
  normalizePrivateChatMessage,
  resolveConversationParticipantId,
  sortChatEntries,
  type ChatEntry,
} from "@/lib/chat";
import { normalizePaymentStatus } from "@/lib/raffle";

interface Stats {
  activeParticipants: number;
  pendingSupportConversations: number;
  totalDraws: number;
  totalParticipants: number;
  totalRevenue: number;
  unreadSupportMessages: number;
}

interface SupportConversationPreview {
  lastDate: string;
  lastMessage: string;
  unreadCount: number;
  userId: string;
  userName: string;
}

function formatSupportDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : format(date, "dd/MM HH:mm", { locale: ptBR });
}

export default function Dashboard() {
  const { session } = useAuth();
  const adminId = session?.user.id ?? null;
  const [stats, setStats] = useState<Stats>({
    activeParticipants: 0,
    pendingSupportConversations: 0,
    totalDraws: 0,
    totalParticipants: 0,
    totalRevenue: 0,
    unreadSupportMessages: 0,
  });
  const [supportQueue, setSupportQueue] = useState<SupportConversationPreview[]>([]);
  const [loadingSupport, setLoadingSupport] = useState(true);
  const hasLoadedSupportRef = useRef(false);

  useEffect(() => {
    if (!adminId) return;

    async function load(options?: { background?: boolean }) {
      const isBackground = options?.background ?? false;

      if (!isBackground || !hasLoadedSupportRef.current) {
        setLoadingSupport(true);
      }

      const [draws, profiles, payments, privateMessages, adminIds] = await Promise.all([
        supabase.from("draws").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("payments").select("amount, user_id, status"),
        supabase.from("private_chat_messages").select("*").limit(500),
        loadAdminUserIds(supabase),
      ]);

      const approvedPayments = (payments.data || []).filter(
        (payment) => normalizePaymentStatus(payment.status) === "paid",
      );
      const revenue = approvedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const activeParticipants = new Set(approvedPayments.map((payment) => payment.user_id)).size;
      const adminUserIds = new Set(adminIds.length ? adminIds : [adminId]);
      const normalizedMessages = privateMessages.error
        ? []
        : sortChatEntries(
            (privateMessages.data ?? [])
              .map((row) => normalizePrivateChatMessage(row))
              .filter((message): message is ChatEntry => Boolean(message)),
          );
      const participantIds = Array.from(
        new Set(
          normalizedMessages
            .map((message) => resolveConversationParticipantId(message, adminUserIds, adminId))
            .filter((userId): userId is string => Boolean(userId && !adminUserIds.has(userId))),
        ),
      );
      const identities = await loadParticipantIdentities(supabase, participantIds);
      const supportMap = new Map<string, SupportConversationPreview>();
      let unreadSupportMessages = 0;

      [...normalizedMessages]
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .forEach((message) => {
          const userId = resolveConversationParticipantId(message, adminUserIds, adminId);

          if (!userId || adminUserIds.has(userId)) return;

          const senderIsParticipant = !adminUserIds.has(message.senderId);
          const receiverIsAdmin = Boolean(message.receiverId && adminUserIds.has(message.receiverId));
          const isUnreadSupportMessage = senderIsParticipant && receiverIsAdmin && !message.read;
          const currentConversation = supportMap.get(userId);

          if (isUnreadSupportMessage) {
            unreadSupportMessages += 1;
          }

          if (!currentConversation) {
            const identity = buildParticipantIdentity(userId, identities);

            supportMap.set(userId, {
              lastDate: message.createdAt,
              lastMessage: message.body,
              unreadCount: isUnreadSupportMessage ? 1 : 0,
              userId,
              userName: identity.name,
            });
            return;
          }

          if (isUnreadSupportMessage) {
            currentConversation.unreadCount += 1;
          }
        });

      const pendingConversations = Array.from(supportMap.values())
        .filter((conversation) => conversation.unreadCount > 0)
        .sort((left, right) => new Date(right.lastDate).getTime() - new Date(left.lastDate).getTime());

      setStats({
        activeParticipants,
        pendingSupportConversations: pendingConversations.length,
        totalDraws: draws.count || 0,
        totalParticipants: profiles.count || 0,
        totalRevenue: revenue,
        unreadSupportMessages,
      });
      setSupportQueue(pendingConversations.slice(0, 4));
      setLoadingSupport(false);
      hasLoadedSupportRef.current = true;
    }

    void load();

    const channel = supabase
      .channel(`dashboard-support:${adminId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "private_chat_messages" }, () => {
        void load({ background: true });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "private_chat_messages" }, () => {
        void load({ background: true });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [adminId]);

  const cards = [
    { title: "Total de Sorteios", value: stats.totalDraws, icon: Trophy, color: "text-accent" },
    { title: "Participantes", value: stats.totalParticipants, icon: Users, color: "text-primary" },
    { title: "Receita Total", value: `R$ ${stats.totalRevenue.toFixed(2)}`, icon: TrendingUp, color: "text-success" },
    { title: "Fila Ativa", value: stats.activeParticipants, icon: CreditCard, color: "text-warning" },
    { title: "Suporte Pendente", value: stats.unreadSupportMessages, icon: MessageCircle, color: "text-primary" },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão geral da plataforma de sorteios"
        action={(
          <Button asChild variant="outline">
            <Link to="/chat">
              Abrir chat
              {stats.unreadSupportMessages > 0 ? (
                <Badge className="ml-1 min-w-5 justify-center px-1.5 py-0 text-[10px]">
                  {stats.unreadSupportMessages}
                </Badge>
              ) : null}
            </Link>
          </Button>
        )}
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className={`h-5 w-5 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{card.value}</p>
              {card.title === "Suporte Pendente" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {stats.pendingSupportConversations} conversa(s) aguardando retorno
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-col gap-4 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-4 w-4 text-primary" />
              Atendimento no suporte
            </CardTitle>
            <CardDescription>
              Novas mensagens privadas dos participantes aparecem aqui até a equipe abrir a conversa.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
              {stats.unreadSupportMessages} mensagem(ns) não lida(s)
            </div>
            <div className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
              {stats.pendingSupportConversations} conversa(s) pendente(s)
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-6">
          {loadingSupport ? (
            <p className="text-sm text-muted-foreground">Carregando pendências do suporte...</p>
          ) : supportQueue.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
              Nenhuma conversa privada aguardando resposta no momento.
            </div>
          ) : (
            <div className="space-y-3">
              {supportQueue.map((conversation) => (
                <Link
                  className="flex items-center gap-3 rounded-xl border border-border/70 px-4 py-3 transition-colors hover:bg-muted/35"
                  key={conversation.userId}
                  state={{ selectedUserId: conversation.userId }}
                  to="/chat"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {conversation.userName}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          {conversation.lastMessage}
                        </p>
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-3">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock3 className="h-3.5 w-3.5" />
                          <span>{formatSupportDate(conversation.lastDate)}</span>
                        </div>
                        <Badge>{conversation.unreadCount}</Badge>
                      </div>
                    </div>
                  </div>

                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
