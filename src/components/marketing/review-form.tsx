"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Star, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SERVICES } from "@/lib/site";
import { submitReview } from "@/server/modules/reviews/public";

const schema = z.object({
  customerName: z.string().min(2, "Please enter your name"),
  city: z.string().optional(),
  serviceType: z.string().optional(),
  reviewText: z.string().min(10, "Please share a little more about your experience"),
  consentToPublish: z.literal(true, { errorMap: () => ({ message: "Please allow us to publish your review" }) }),
});
type FormValues = z.infer<typeof schema>;

const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function ReviewForm() {
  const [submitted, setSubmitted] = React.useState(false);
  const [rating, setRating] = React.useState(5);
  const [hover, setHover] = React.useState(0);
  const [photo, setPhoto] = React.useState<{ name: string; dataUrl: string } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const serviceType = watch("serviceType");
  const consent = watch("consentToPublish");

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error("Image is too large (max 6 MB).");
      return;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      setPhoto({ name: file.name, dataUrl });
    } catch {
      toast.error("Could not read that image.");
    }
  }

  async function onSubmit(values: FormValues) {
    const res = await submitReview({
      customerName: values.customerName,
      city: values.city ?? "",
      serviceType: values.serviceType ?? "",
      rating,
      reviewText: values.reviewText,
      consentToPublish: true,
      photoDataUrl: photo?.dataUrl ?? "",
    });
    if (res.ok) {
      setSubmitted(true);
      toast.success("Thank you! Your review is now live on our site.");
    } else {
      toast.error(res.error);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-10 text-center">
        <CheckCircle2 className="size-12 text-metal" />
        <h3 className="font-display text-2xl font-semibold">Thank you!</h3>
        <p className="max-w-sm text-muted-foreground">
          Your review is now live on our site. We appreciate you taking the time to share your experience.
        </p>
      </div>
    );
  }

  const shownRating = hover || rating;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8">
      {/* Star rating */}
      <div className="space-y-1.5">
        <Label className="text-sm">Your rating</Label>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {Array.from({ length: 5 }).map((_, i) => {
            const value = i + 1;
            return (
              <button
                key={value}
                type="button"
                aria-label={`${value} star${value > 1 ? "s" : ""}`}
                onMouseEnter={() => setHover(value)}
                onClick={() => setRating(value)}
                className="p-0.5 transition-transform hover:scale-110"
              >
                <Star
                  className={cn(
                    "size-7",
                    value <= shownRating ? "fill-[var(--metal-bright)] text-metal" : "text-muted-foreground/40"
                  )}
                />
              </button>
            );
          })}
          <span className="ml-2 text-sm text-muted-foreground">{shownRating}/5</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" error={errors.customerName?.message}>
          <Input {...register("customerName")} placeholder="Jane D." />
        </Field>
        <Field label="City">
          <Input {...register("city")} placeholder="Frisco, TX" />
        </Field>
      </div>

      <Field label="Service used">
        <Select value={serviceType} onValueChange={(v) => setValue("serviceType", v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a service" />
          </SelectTrigger>
          <SelectContent className="dark bg-popover text-popover-foreground">
            {SERVICES.map((s) => (
              <SelectItem key={s.slug} value={s.title}>
                {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Your review" error={errors.reviewText?.message}>
        <Textarea {...register("reviewText")} rows={5} placeholder="Tell us about your experience with Anexa Homes…" />
      </Field>

      {/* Optional photo */}
      <div className="space-y-1.5">
        <Label className="text-sm">Add a photo (optional)</Label>
        <input ref={fileRef} type="file" accept="image/*" onChange={onPhoto} className="hidden" />
        {photo ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.dataUrl} alt="" className="size-14 rounded-lg object-cover" />
            <span className="flex-1 truncate text-sm text-muted-foreground">{photo.name}</span>
            <Button type="button" variant="ghost" size="icon" onClick={() => setPhoto(null)} aria-label="Remove photo">
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="w-full gap-2">
            <ImagePlus className="size-4" /> Upload a photo of your project
          </Button>
        )}
      </div>

      {/* Consent */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-4">
        <Checkbox
          id="consent"
          checked={!!consent}
          onCheckedChange={(v) => setValue("consentToPublish", (v === true) as true, { shouldValidate: true })}
        />
        <Label htmlFor="consent" className="text-sm font-normal leading-relaxed text-muted-foreground">
          I allow Anexa Homes to publish my review, name, and city on its website and marketing.
        </Label>
      </div>
      {errors.consentToPublish && <p className="-mt-3 text-xs text-destructive">{errors.consentToPublish.message}</p>}

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
          "Submit Review"
        )}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Reviews are checked by our team before they appear publicly.
      </p>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
