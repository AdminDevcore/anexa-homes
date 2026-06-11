"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitWebsiteLead } from "@/server/modules/leads/intake";
import { SERVICES } from "@/lib/site";

const formSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().min(7, "Enter a valid phone"),
  address: z.string().optional(),
  city: z.string().optional(),
  zip: z.string().optional(),
  service: z.string().optional(),
  message: z.string().optional(),
  preferredDate: z.string().optional(),
  preferredTime: z.string().optional(),
  propertyType: z.string().optional(),
  homeowner: z.string().optional(),
  timeframe: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

const TIME_OPTIONS = [
  { value: "morning", label: "Morning (8–11 AM)" },
  { value: "midday", label: "Midday (11 AM–2 PM)" },
  { value: "afternoon", label: "Afternoon (2–5 PM)" },
  { value: "evening", label: "Evening (5–7 PM)" },
];
const PROPERTY_TYPES = ["Single-family home", "Townhouse", "Multi-family", "Commercial"];
const TIMEFRAMES = ["As soon as possible", "Within 1–3 months", "3+ months / just exploring"];

export function ContactForm({
  defaultType = "inspection",
  defaultService,
  hideProperty = false,
  hideService = false,
  submitLabel = "Request Free Inspection",
  messageLabel = "How can we help?",
  messagePlaceholder = "Tell us about your roof or recent storm damage…",
  successText = "Your request has been received. An Anexa Homes specialist will contact you within 24 hours to schedule your free inspection.",
}: {
  defaultType?: "inspection" | "claim" | "general" | "careers";
  defaultService?: string;
  hideProperty?: boolean;
  hideService?: boolean;
  submitLabel?: string;
  messageLabel?: string;
  messagePlaceholder?: string;
  successText?: string;
}) {
  const [submitted, setSubmitted] = React.useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { service: defaultService ?? "roofing" },
  });

  const service = watch("service");
  const showScheduling = defaultType !== "careers";
  const preferredTime = watch("preferredTime");
  const propertyType = watch("propertyType");
  const homeowner = watch("homeowner");
  const timeframe = watch("timeframe");
  // Earliest selectable appointment date = tomorrow.
  const minDate = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, []);

  async function onSubmit(values: FormValues) {
    const res = await submitWebsiteLead({ ...values, type: defaultType });
    if (res.ok) {
      setSubmitted(true);
      toast.success("Request received — we'll reach out within 24 hours.");
    } else {
      toast.error(res.error);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-10 text-center">
        <CheckCircle2 className="size-12 text-gold" />
        <h3 className="font-display text-2xl font-semibold">Thank you!</h3>
        <p className="max-w-sm text-muted-foreground">{successText}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" error={errors.firstName?.message}>
          <Input {...register("firstName")} placeholder="Jane" />
        </Field>
        <Field label="Last name" error={errors.lastName?.message}>
          <Input {...register("lastName")} placeholder="Doe" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" {...register("email")} placeholder="jane@email.com" />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input {...register("phone")} placeholder="(555) 123-4567" />
        </Field>
      </div>
      {!hideProperty && (
        <>
          <Field label="Property address" error={errors.address?.message}>
            <Input {...register("address")} placeholder="123 Oak Street" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" error={errors.city?.message}>
              <Input {...register("city")} placeholder="Dallas" />
            </Field>
            <Field label="ZIP" error={errors.zip?.message}>
              <Input {...register("zip")} placeholder="75201" />
            </Field>
          </div>
        </>
      )}
      {showScheduling && (
        <>
          <div className="space-y-4 rounded-xl border border-gold/30 bg-gold/[0.04] p-4">
            <p className="text-sm font-semibold">Pick a time for your free inspection</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Preferred date" error={errors.preferredDate?.message}>
                <Input type="date" min={minDate} required {...register("preferredDate")} />
              </Field>
              <Field label="Preferred time">
                <Select value={preferredTime} onValueChange={(v) => setValue("preferredTime", v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select a window" /></SelectTrigger>
                  <SelectContent className="dark bg-popover text-popover-foreground">
                    {TIME_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Property type">
              <Select value={propertyType} onValueChange={(v) => setValue("propertyType", v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="dark bg-popover text-popover-foreground">
                  {PROPERTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Are you the homeowner?">
              <Select value={homeowner} onValueChange={(v) => setValue("homeowner", v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="dark bg-popover text-popover-foreground">
                  <SelectItem value="Yes, I own this property">Yes, I own this property</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="When are you looking to start?">
            <Select value={timeframe} onValueChange={(v) => setValue("timeframe", v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select a timeframe" /></SelectTrigger>
              <SelectContent className="dark bg-popover text-popover-foreground">
                {TIMEFRAMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </>
      )}
      {!hideService && (
        <Field label="I'm interested in">
          <Select value={service} onValueChange={(v) => setValue("service", v)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a service" />
            </SelectTrigger>
            <SelectContent className="dark bg-popover text-popover-foreground">
              {SERVICES.map((s) => (
                <SelectItem key={s.slug} value={s.slug}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field label={messageLabel} error={errors.message?.message}>
        <Textarea {...register("message")} rows={4} placeholder={messagePlaceholder} />
      </Field>

      <Button
        type="submit"
        size="lg"
        disabled={isSubmitting}
        className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Submitting…
          </>
        ) : (
          submitLabel
        )}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        By submitting, you agree to be contacted by Anexa Homes. No spam, ever.
      </p>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
