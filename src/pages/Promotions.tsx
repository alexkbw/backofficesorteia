import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/externalClient";

const DEFAULT_PROMOTION_AMOUNT = 10;
const DEFAULT_PROMOTION_IMAGE = "/placeholder.svg";

type Promotion = {
  active?: boolean | null;
  created_at: string;
  description: string | null;
  end_date: string | null;
  entry_amount?: number | null;
  id: string;
  image_url: string | null;
  is_active?: boolean | null;
  start_date: string | null;
  title: string;
};

type PromotionForm = {
  description: string;
  end_date: string;
  entry_amount: string;
  image_url: string;
  start_date: string;
  title: string;
};

const emptyForm: PromotionForm = {
  description: "",
  end_date: "",
  entry_amount: DEFAULT_PROMOTION_AMOUNT.toFixed(2),
  image_url: "",
  start_date: "",
  title: "",
};

function getPromotionsTable() {
  return (supabase as unknown as { from: (table: string) => any }).from("promotions");
}

function formatCurrency(value?: number | null) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    style: "currency",
  }).format(Number(value ?? DEFAULT_PROMOTION_AMOUNT));
}

function normalizeAmount(value: string) {
  const normalized = Number.parseFloat(value.replace(",", "."));

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return DEFAULT_PROMOTION_AMOUNT;
  }

  return Number(normalized.toFixed(2));
}

function isPromotionActive(promotion: Promotion) {
  if (typeof promotion.is_active === "boolean") {
    return promotion.is_active;
  }

  if (typeof promotion.active === "boolean") {
    return promotion.active;
  }

  return true;
}

function isSchemaDriftError(error: { details?: string; hint?: string; message?: string } | null) {
  const message = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`.toLowerCase();

  return (
    message.includes("column") ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("could not find")
  );
}

async function savePromotion(
  editingId: string | null,
  form: PromotionForm,
) {
  const amount = normalizeAmount(form.entry_amount);
  const basePayload = {
    description: form.description || null,
    end_date: form.end_date || null,
    image_url: form.image_url || DEFAULT_PROMOTION_IMAGE,
    start_date: form.start_date || null,
    title: form.title.trim(),
  };

  const payloads = [
    { ...basePayload, entry_amount: amount, is_active: true },
    { ...basePayload, entry_amount: amount, active: true },
    { ...basePayload, is_active: true },
    { ...basePayload, active: true },
  ];

  let lastError: { details?: string; hint?: string; message?: string } | null = null;

  for (const payload of payloads) {
    const query = editingId
      ? getPromotionsTable().update(payload).eq("id", editingId)
      : getPromotionsTable().insert(payload);

    const { error } = await query;

    if (!error) {
      return { error: null };
    }

    lastError = error;

    if (!isSchemaDriftError(error)) {
      return { error };
    }
  }

  return { error: lastError };
}

export default function Promotions() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PromotionForm>(emptyForm);

  const load = async () => {
    const { data, error } = await getPromotionsTable()
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao carregar promoções");
      setLoading(false);
      return;
    }

    setPromotions((data || []) as Promotion[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error("Informe o título da promoção");
      return;
    }

    const { error } = await savePromotion(editingId, form);

    if (error) {
      toast.error(error.message || "Erro ao salvar");
      return;
    }

    toast.success(editingId ? "Promoção atualizada!" : "Promoção criada!");
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    await load();
  };

  const handleEdit = (promotion: Promotion) => {
    setEditingId(promotion.id);
    setForm({
      description: promotion.description || "",
      end_date: promotion.end_date || "",
      entry_amount: Number(promotion.entry_amount ?? DEFAULT_PROMOTION_AMOUNT).toFixed(2),
      image_url: promotion.image_url === DEFAULT_PROMOTION_IMAGE ? "" : promotion.image_url || "",
      start_date: promotion.start_date || "",
      title: promotion.title,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    const { error } = await getPromotionsTable().delete().eq("id", id);

    if (error) {
      toast.error("Erro ao excluir");
      return;
    }

    toast.success("Promoção excluída!");
    await load();
  };

  return (
    <>
      <PageHeader
        title="Promoções"
        description="Gerenciar banners, campanhas e o valor padrão de entrada"
        action={
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);

              if (!open) {
                setEditingId(null);
                setForm(emptyForm);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nova Promoção
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? "Editar" : "Nova"} Promoção</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label>Título</Label>
                  <Input
                    value={form.title}
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                  />
                </div>

                <div>
                  <Label>Descrição</Label>
                  <Textarea
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Valor</Label>
                    <Input
                      min="0"
                      step="0.01"
                      type="number"
                      value={form.entry_amount}
                      onChange={(event) => setForm({ ...form, entry_amount: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label>URL da Imagem</Label>
                    <Input
                      placeholder="/placeholder.svg"
                      value={form.image_url}
                      onChange={(event) => setForm({ ...form, image_url: event.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Início</Label>
                    <Input
                      type="date"
                      value={form.start_date}
                      onChange={(event) => setForm({ ...form, start_date: event.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Fim</Label>
                    <Input
                      type="date"
                      value={form.end_date}
                      onChange={(event) => setForm({ ...form, end_date: event.target.value })}
                    />
                  </div>
                </div>

                <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Se a imagem ficar vazia, usamos ` /placeholder.svg ` para evitar erro de criação.
                </p>

                <Button className="w-full" onClick={() => void handleSave()}>
                  Salvar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={5}>
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : promotions.length === 0 ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={5}>
                    Nenhuma promoção
                  </TableCell>
                </TableRow>
              ) : (
                promotions.map((promotion) => (
                  <TableRow key={promotion.id}>
                    <TableCell className="font-medium">{promotion.title}</TableCell>
                    <TableCell>{formatCurrency(promotion.entry_amount)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {promotion.start_date
                        ? format(new Date(promotion.start_date), "dd/MM", { locale: ptBR })
                        : "—"}{" "}
                      →{" "}
                      {promotion.end_date
                        ? format(new Date(promotion.end_date), "dd/MM", { locale: ptBR })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={isPromotionActive(promotion) ? "active" : "inactive"} />
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => handleEdit(promotion)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void handleDelete(promotion.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
