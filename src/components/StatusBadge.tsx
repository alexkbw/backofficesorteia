import { Badge } from "@/components/ui/badge";

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: "Pendente", className: "bg-warning/10 text-warning border-warning/20" },
  paid: { label: "Pago", className: "bg-success/10 text-success border-success/20" },
  failed: { label: "Falhou", className: "bg-destructive/10 text-destructive border-destructive/20" },
  active: { label: "Ativo", className: "bg-success/10 text-success border-success/20" },
  inactive: { label: "Inativo", className: "bg-muted text-muted-foreground border-border" },
  scheduled: { label: "Agendado", className: "bg-primary/10 text-primary border-primary/20" },
  completed: { label: "Concluído", className: "bg-success/10 text-success border-success/20" },
  drawn: { label: "Sorteado", className: "bg-accent/10 text-accent-foreground border-accent/20" },
};

export default function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}
