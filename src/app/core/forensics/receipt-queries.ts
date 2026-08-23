import { ReceiptCategory } from '../models/forensics.model';

export interface ReceiptQuery {
  category: ReceiptCategory;
  /** Shown on the exhibit stamp in the report. */
  label: string;
  /**
   * Several paraphrases per category, averaged into one centroid. A single query string is a
   * brittle target — one phrasing anchors the search to its own incidental vocabulary, while
   * a centroid of several sits nearer the middle of the behaviour they share.
   */
  phrases: string[];
}

export const RECEIPT_QUERIES: ReceiptQuery[] = [
  {
    category: 'passive-aggressive',
    label: 'Passive-aggressive',
    phrases: [
      "fine, whatever, do what you want, it doesn't matter to me",
      "no it's fine, I'm not upset, just forget I said anything",
      'must be nice for some people, wouldn\'t know myself',
      'wow, ok, good to know where I stand with everyone',
    ],
  },
  {
    category: 'guilt-trip',
    label: 'Guilt trip',
    phrases: [
      'after everything I have done for you, this is what I get',
      'I guess I will just handle it myself like I always do',
      "don't worry about me, I'll be fine on my own as usual",
      'I always make time for you but you never do the same for me',
      // Group-directed martyrdom, not just one-to-one. Without this the centroid is entirely
      // dyadic ("for you") and drifts to the humble-brag/fishing phrases, which is exactly
      // how "after everything I've done for this group, nobody replies" got mislabelled.
      'nobody in this group ever appreciates anything I do for everyone here',
      'I am always the one who has to hold this whole group together',
    ],
  },
  {
    category: 'unsolicited-advice',
    label: 'Unsolicited advice',
    phrases: [
      'you should really just try doing it this way instead',
      'honestly what you need to do is stop overthinking the whole thing',
      'if I were you I would have handled that completely differently',
      'have you tried just being more organized and planning it out properly',
    ],
  },
  {
    category: 'fishing-for-compliments',
    label: 'Fishing for compliments',
    phrases: [
      'I look absolutely terrible in this photo, I hate how I look',
      'I am probably the worst at this out of everyone here honestly',
      // "nobody ever notices what I do" used to live here, but it is martyrdom rather than
      // compliment-fishing, and it was poaching guilt-trip's matches.
      'I am sure everyone thinks I did a really terrible job of it',
      'I doubt anyone would even care if I showed up or not',
    ],
  },
  {
    category: 'humble-brag',
    label: 'Humble brag',
    phrases: [
      'so exhausted from all the travel for work again this month',
      'ugh I got promoted again, so much more responsibility now',
      'it is so annoying how everyone keeps asking me for help with everything',
      'I barely studied for it and somehow still did really well',
    ],
  },
  {
    category: 'dismissiveness',
    label: 'Dismissive',
    phrases: [
      'that is not a big deal, you are completely overreacting about it',
      'anyway, moving on, can we talk about something else now',
      'ok cool whatever, sure, if you say so',
      'why are you even making this into a whole thing',
    ],
  },
];

export const RECEIPT_CATEGORY_LABELS: Record<ReceiptCategory, string> = RECEIPT_QUERIES.reduce(
  (acc, q) => ({ ...acc, [q.category]: q.label }),
  {} as Record<ReceiptCategory, string>,
);
