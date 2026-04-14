import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "react-router-dom";
import { ArrowRight, BarChart3, Clock3, CreditCard, MessageCircle, Trophy, TrendingUp, Users } from "lucide-react";

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
import {
  getPaymentAttributionLabel,
  getPaymentAttributionSource,
  hasPaymentAttribution,
  normalizePaymentStatus,
} from "@/lib/raffle";

interface Stats {
  activeParticipants: number;
  activeTrafficSources: number;
  attributedApprovedPayments: number;
  attributedCheckouts: number;
  attributedRevenue: number;
  topCampaignLabel: string;
  pendingSupportConversations: number;
  totalDraws: number;
  totalParticipants: number;
  totalRevenue: number;
  unreadSupportMessages: number;
}

interface CampaignPerformanceRow {
  approvedPayments: number;
  initiatedCheckouts: number;
  key: string;
  label: string;
  revenue: number;
  sourceLabel: string;
}

interface SupportConversationPreview {
  lastDate: string;
  lastMessage: string;
  unreadCount: number;
  userId: string;
  userName: string;
}

function normalizeSourceKey(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized || "nao_atribuido";
}

function formatSourceLabel(value?: string | null) {
  const normalized = normalizeSourceKey(value);

  switch (normalized) {
    case "facebook":
      return "Facebook";
    case "google":
      return "Google";
    case "instagram":
      return "Instagram";
    case "kwai":
      return "Kwai";
    case "meta":
      return "Meta";
    case "tiktok":
      return "TikTok";
    case "x":
      return "X";
    case "youtube":
      return "YouTube";
    default:
      return normalized === "nao_atribuido"
        ? "Nao atribuido"
        : normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
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
    activeTrafficSources: 0,
    attributedApprovedPayments: 0,
    attributedCheckouts: 0,
    attributedRevenue: 0,
    topCampaignLabel: "Sem dados ainda",
    pendingSupportConversations: 0,
    totalDraws: 0,
    totalParticipants: 0,
    totalRevenue: 0,
    unreadSupportMessages: 0,
  });
  const [campaignPerformance, setCampaignPerformance] = useState<CampaignPerformanceRow[]>([]);
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
        supabase
          .from("payments")
          .select("amount, user_id, status, attribution_source, attribution_campaign, attribution_id"),
        supabase.from("private_chat_messages").select("*").limit(500),
        loadAdminUserIds(supabase),
      ]);

      const allPayments = payments.data || [];
      const approvedPayments = allPayments.filter(
        (payment) => normalizePaymentStatus(payment.status) === "paid",
      );
      const revenue = approvedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
      const activeParticipants = new Set(approvedPayments.map((payment) => payment.user_id)).size;
      const attributedPayments = allPayments.filter((payment) => hasPaymentAttribution(payment));
      const attributedApprovedPayments = attributedPayments.filter(
        (payment) => normalizePaymentStatus(payment.status) === "paid",
      );
      const attributedRevenue = attributedApprovedPayments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0,
      );
      const activeTrafficSources = new Set(
        attributedPayments.map((payment) => normalizeSourceKey(getPaymentAttributionSource(payment))),
      ).size;
      const campaignMap = new Map<string, CampaignPerformanceRow>();

      for (const payment of attributedPayments) {
        const sourceLabel = formatSourceLabel(getPaymentAttributionSource(payment));
        const label = getPaymentAttributionLabel(payment);
        const key = `${sourceLabel}::${label}`;
        const current = campaignMap.get(key) ?? {
          approvedPayments: 0,
          initiatedCheckouts: 0,
          key,
          label,
          revenue: 0,
          sourceLabel,
        };

        current.initiatedCheckouts += 1;

        if (normalizePaymentStatus(payment.status) === "paid") {
          current.approvedPayments += 1;
          current.revenue += Number(payment.amount || 0);
        }

        campaignMap.set(key, current);
      }

      const topCampaigns = Array.from(campaignMap.values())
        .sort((left, right) => {
          if (right.revenue !== left.revenue) {
            return right.revenue - left.revenue;
          }

          if (right.approvedPayments !== left.approvedPayments) {
            return right.approvedPayments - left.approvedPayments;
          }

          return right.initiatedCheckouts - left.initiatedCheckouts;
        })
        .slice(0, 6);
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
        activeTrafficSources,
        attributedApprovedPayments: attributedApprovedPayments.length,
        attributedCheckouts: attributedPayments.length,
        attributedRevenue,
        topCampaignLabel: topCampaigns[0]?.label ?? "Sem dados ainda",
        pendingSupportConversations: pendingConversations.length,
        totalDraws: draws.count || 0,
        totalParticipants: profiles.count || 0,
        totalRevenue: revenue,
        unreadSupportMessages,
      });
      setCampaignPerformance(topCampaigns);
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

  const attributionCards = [
    {
      description: "Pagamentos pendentes ou concluidos com origem de campanha salva.",
      title: "Checkouts atribuidos",
      value: stats.attributedCheckouts,
    },
    {
      description: "Compras aprovadas que chegaram por campanhas identificadas.",
      title: "Compras atribuidas",
      value: stats.attributedApprovedPayments,
    },
    {
      description: "Receita das compras aprovadas com origem interna identificada.",
      title: "Receita atribuida",
      value: `R$ ${stats.attributedRevenue.toFixed(2)}`,
    },
    {
      description: "Quantidade de canais com pelo menos um checkout identificado.",
      title: "Canais ativos",
      value: stats.activeTrafficSources,
    },
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

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_0.95fr]">
        <Card>
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              Campanhas internas
            </CardTitle>
            <CardDescription>
              Visao basica por origem e campanha, sem depender das APIs externas das plataformas.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            {campaignPerformance.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
                Nenhum checkout com UTM foi registrado ainda. Assim que os anuncios comecarem a usar `utm_source`,
                `utm_campaign` e `utm_id`, este resumo aparece aqui.
              </div>
            ) : (
              <div className="space-y-3">
                {campaignPerformance.map((campaign) => {
                  const conversionRate = campaign.initiatedCheckouts
                    ? Math.round((campaign.approvedPayments / campaign.initiatedCheckouts) * 100)
                    : 0;

                  return (
                    <div
                      className="rounded-xl border border-border/70 bg-muted/20 px-4 py-4"
                      key={campaign.key}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{campaign.label}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                            {campaign.sourceLabel}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-sm font-semibold text-foreground">
                            R$ {campaign.revenue.toFixed(2)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {campaign.approvedPayments} compra(s) aprovada(s)
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
                        <div className="rounded-lg bg-background/60 px-3 py-2">
                          {campaign.initiatedCheckouts} checkout(s) iniciado(s)
                        </div>
                        <div className="rounded-lg bg-background/60 px-3 py-2">
                          {campaign.approvedPayments} compra(s) aprovada(s)
                        </div>
                        <div className="rounded-lg bg-background/60 px-3 py-2">
                          {conversionRate}% de conversao interna
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-1">
          {attributionCards.map((card) => (
            <Card key={card.title}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{card.value}</p>
                <p className="mt-2 text-xs text-muted-foreground">{card.description}</p>
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Campanha lider</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-semibold text-foreground">{stats.topCampaignLabel}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Este destaque considera primeiro a receita, depois compras aprovadas e por fim o volume de checkouts.
              </p>
            </CardContent>
          </Card>
        </div>
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
                  to={`/chat?user=${encodeURIComponent(conversation.userId)}`}
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
