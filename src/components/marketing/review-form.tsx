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
  const [photos, setPhotos] = React.useState<{ name: string; dataUrl: string }[]>([]);
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
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const next: { name: string; dataUrl: string }[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        toast.error("Please choose image files.");
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        toast.error(`${file.name} is too large (max 6 MB).`);
        continue;
      }
      try {
        next.push({ name: file.name, dataUrl: await readAsDataUrl(file) });
      } catch {
        toast.error("Could not read an image.");
      }
    }
    setPhotos((prev) => [...prev, ...next].slice(0, 6));
    if (fileRef.current) fileRef.current.value = ""; // let the same file be re-picked
  }

  async function onSubmit(values: FormValues) {
    const res = await submitReview({
      customerName: values.customerName,
      city: values.city ?? "",
      serviceType: values.serviceType ?? "",
      rating,
      reviewText: values.reviewText,
      consentToPublish: true,
      photoDataUrls: photos.map((p) => p.dataUrl),
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

      {/* Optional photos (of the work) — up to 6 */}
      <div className="space-y-1.5">
        <Label className="text-sm">Add photos of the work (optional)</Label>
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={onPhoto} className="hidden" />
        {photos.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl} alt={p.name} className="size-16 rounded-lg object-cover ring-1 ring-border" loading="lazy" decoding="async" />
                <button
                  type="button"
                  onClick={() => setPhotos((prev) => prev.filter((_, k) => k !== i))}
                  aria-label="Remove photo"
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {photos.length < 6 ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="grid size-16 place-items-center rounded-lg border border-dashed border-border text-muted-foreground hover:bg-muted"
                aria-label="Add more photos"
              >
                <ImagePlus className="size-5" />
              </button>
            ) : null}
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="w-full gap-2">
            <ImagePlus className="size-4" /> Upload photos of your project
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
        Your review publishes to our site right away.
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
