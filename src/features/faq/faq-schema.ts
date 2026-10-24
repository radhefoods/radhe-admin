import { z } from "zod";
import {
  FAQ_RULES,
  type Faq,
  type FaqGroup,
  type FaqGroupInput,
  type FaqGroupPatch,
  type FaqInput,
  type FaqPatch,
} from "@/lib/api/types";
import { translatedDefaults, zTranslated } from "@/lib/validation";

// The rules of the API for groups and questions (22): English is required,
// German may follow; the answer is plain text or Markdown.

export const groupSchema = z.object({
  name: zTranslated(
    FAQ_RULES.groupNameMaxLength,
    "The English name is required.",
  ),
  isVisible: z.boolean(),
});
export type GroupFormValues = z.input<typeof groupSchema>;
export type GroupFormOutput = z.output<typeof groupSchema>;

export function groupDefaults(group?: FaqGroup): GroupFormValues {
  return {
    name: translatedDefaults(group?.name),
    isVisible: group?.isVisible ?? true,
  };
}

export function toGroupInput(values: GroupFormOutput): FaqGroupInput {
  return { name: values.name, isVisible: values.isVisible };
}

/** Only what changed. */
export function toGroupPatch(
  values: GroupFormOutput,
  group: FaqGroup,
): FaqGroupPatch {
  const patch: FaqGroupPatch = {};
  if (
    values.name.en !== group.name.en ||
    (values.name.de ?? null) !== (group.name.de ?? null)
  ) {
    patch.name = values.name;
  }
  if (values.isVisible !== group.isVisible) patch.isVisible = values.isVisible;
  return patch;
}

export const faqSchema = z.object({
  question: zTranslated(
    FAQ_RULES.questionMaxLength,
    "The English question is required.",
  ),
  answer: zTranslated(
    FAQ_RULES.answerMaxLength,
    "The English answer is required.",
  ),
  /** The id of the group, or `""` for none. */
  groupId: z.string(),
  isPublished: z.boolean(),
});
export type FaqFormValues = z.input<typeof faqSchema>;
export type FaqFormOutput = z.output<typeof faqSchema>;

export function faqDefaults(
  faq?: Faq,
  groupId: string | null = null,
): FaqFormValues {
  return {
    question: translatedDefaults(faq?.question),
    answer: translatedDefaults(faq?.answer),
    groupId: faq ? (faq.groupId ?? "") : (groupId ?? ""),
    isPublished: faq?.isPublished ?? false,
  };
}

export function toFaqInput(values: FaqFormOutput): FaqInput {
  return {
    question: values.question,
    answer: values.answer,
    groupId: values.groupId || null,
    isPublished: values.isPublished,
  };
}

/** Only what changed; `groupId: null` takes the question out of its group. */
export function toFaqPatch(values: FaqFormOutput, faq: Faq): FaqPatch {
  const patch: FaqPatch = {};
  const same = (
    a: { en: string; de?: string | null },
    b: { en: string; de?: string | null },
  ) => a.en === b.en && (a.de ?? null) === (b.de ?? null);
  if (!same(values.question, faq.question)) patch.question = values.question;
  if (!same(values.answer, faq.answer)) patch.answer = values.answer;
  if ((values.groupId || null) !== faq.groupId)
    patch.groupId = values.groupId || null;
  if (values.isPublished !== faq.isPublished)
    patch.isPublished = values.isPublished;
  return patch;
}
