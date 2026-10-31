// Ported 1:1 from AgenticDesigner/DesignIntelligence/ComponentFactory.swift
//
// The Swift file imports AppKit for one thing only: NSFont-based text
// measurement inside `fittingFontSize`. That goes through the injected
// `TextMeasurer` platform adapter (deterministic SF Pro approximation by
// default; the web app injects a canvas-based measurer).

import { makeDesignNode, makeNodeStyle, type DesignNode, type NodeStyle, type ShadowStyle, type TextBehavior } from '../models/DesignNode';
import type { GradientStyle } from '../models/GradientStyle';
import type { ComponentType } from '../models/ComponentType';
import type { DesignTokens } from '../designSystem/DesignTokens';
import { makeDesignAction, swiftDouble, type DesignAction } from '../agent/DesignAction';
import { getTextMeasurer } from '../platform/TextMeasurer';

// MARK: - private func makeStyle(...)

interface MakeStyleInit {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  opacity?: number;
  fontSize?: number;
  fontWeight?: string;
  textColor?: string;
  textAlign?: string;
  letterSpacing?: number;
  lineHeight?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  layout?: string;
  spacing?: number;
  shadow?: ShadowStyle;
  blur?: number;
  backgroundBlur?: number;
  overlayColor?: string;
  overlayOpacity?: number;
  gradient?: GradientStyle;
}

function makeStyle(init: MakeStyleInit): NodeStyle {
  return makeNodeStyle({
    ...init,
    fill: init.fill,
    cornerRadius: init.cornerRadius ?? 0,
    opacity: init.opacity ?? 1.0,
  });
}

// MARK: - Swift string / collection helpers

type Props = Record<string, string> | undefined;

/** `props?["key"]` — a missing key is nil, an empty string is a value. */
function prop(props: Props, key: string): string | undefined {
  if (props === undefined) return undefined;
  const value = props[key];
  return value === undefined ? undefined : value;
}

/** `String.trimmingCharacters(in: .whitespaces)` */
function trimWhitespaces(text: string): string {
  return text.replace(/^[\p{Zs}\t]+/u, '').replace(/[\p{Zs}\t]+$/u, '');
}

/** `String.trimmingCharacters(in: .whitespacesAndNewlines)` */
function trimWhitespacesAndNewlines(text: string): string {
  return text.trim();
}

/** `String.split(separator:)` — omits empty subsequences, like Swift's default. */
function swiftSplit(text: string, separator: string, maxSplits?: number): string[] {
  if (maxSplits === undefined) {
    return text.split(separator).filter((part) => part.length > 0);
  }
  // maxSplits with omittingEmptySubsequences: Swift only counts non-empty pieces.
  const result: string[] = [];
  let rest = text;
  let splits = 0;
  while (splits < maxSplits) {
    const index = rest.indexOf(separator);
    if (index < 0) break;
    const head = rest.slice(0, index);
    rest = rest.slice(index + separator.length);
    if (head.length > 0) {
      result.push(head);
      splits += 1;
    }
  }
  if (rest.length > 0) result.push(rest);
  return result;
}

/** `String.count` — grapheme-ish character count (code points). */
function charCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** Swift `Int(...)` truncation toward zero. */
function swiftIntTruncating(value: number): number {
  return Math.trunc(value);
}

/** Swift `Double.rounded()` — half away from zero. */
function swiftRounded(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

// MARK: - ComponentFactory

// Create pre-designed components based on DesignRecipe and DesignTokens
export const ComponentFactory = {
  /// A deterministic, watch-sized runner screen (marked appleWatch-only).
  /// Built in code — NOT by the model — so a watch app appears for ANY AI
  /// that triggers a watch build, not just one smart enough to design it.
  watchRunnerScreen(activity: string = 'Outdoor Run'): DesignNode {
    const w = 198;
    const h = 242;
    const frame = makeDesignNode({
      type: 'Frame',
      name: 'Watch Runner',
      x: 0, y: 0, width: w, height: h,
      style: makeStyle({ fill: '#0B0B0F', cornerRadius: 44 }),
      children: [
        makeDesignNode({
          type: 'Text', name: 'Activity', x: 16, y: 18, width: w - 32, height: 16,
          text: activity.toUpperCase(),
          style: transparentTextStyle(11, 'semibold', '#9CA3AF'),
        }),
        makeDesignNode({
          type: 'Text', name: 'Distance', x: 16, y: 40, width: w - 32, height: 46,
          text: '0.00 km',
          style: transparentTextStyle(40, 'bold', '#34D399'),
        }),
        makeDesignNode({
          type: 'Text', name: 'Pace', x: 16, y: 92, width: w - 32, height: 20,
          text: '—:— /km',
          style: transparentTextStyle(15, 'medium', '#FFFFFF'),
        }),
        makeDesignNode({
          type: 'Text', name: 'Heart Rate', x: 16, y: 116, width: w - 32, height: 18,
          text: '— bpm · Zone —',
          style: transparentTextStyle(13, undefined, '#9CA3AF'),
        }),
        makeDesignNode({
          type: 'Button', name: 'Start Run', x: 16, y: h - 56, width: w - 32, height: 44,
          text: 'Start',
          style: makeStyle({ fill: '#34D399', cornerRadius: 22, fontSize: 16, fontWeight: 'bold', textColor: '#0B0B0F' }),
        }),
      ],
    });
    frame.supportedPlatforms = ['appleWatch'];
    return frame;
  },

  createComponent(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
    switch (type) {
      case 'avatarGreetingHeader':
        return createAvatarGreetingHeader(props, action, tokens);
      case 'balanceHeroCard':
        return createBalanceHeroCard(props, action, tokens);
      case 'quickActionRow':
        return createQuickActionRow(props, action, tokens);
      case 'progressRing':
        return createProgressRing(props, action, tokens);
      case 'workoutCard':
        return createWorkoutCard(props, action, tokens);
      case 'transactionRow':
        return createTransactionRow(props, action, tokens);
      case 'transactionList':
        return createTransactionList(props, action, tokens);
      case 'chartCard':
        return createChartCard(props, action, tokens);
      case 'metricCard':
      case 'statCard':
      case 'currencyCard':
        return createMetricCard(type, props, action, tokens);
      case 'currencyCardGrid':
        return createCurrencyCardGrid(props, action, tokens);
      case 'bottomNavBar':
        return createBottomNavBar(props, action, tokens);
      case 'header':
        return createHeader(props, action, tokens);
      case 'searchBar':
        return createSearchBar(props, action, tokens);
      case 'categoryChips':
        return createCategoryChips(props, action, tokens);
      case 'heroCard':
        return createHeroCard(props, action, tokens);
      case 'contentCard':
        return createContentCard(type, props, action, tokens);
      case 'largeIconTile':
        return createLargeIconTile(props, action, tokens);
      case 'iconFeatureGrid':
        return createIconFeatureGrid(props, action, tokens);
      case 'chatMessage':
        return createChatMessage(props, action, tokens);
      case 'chatInput':
        return createChatInput(props, action, tokens);

      case 'imageHero':
      case 'imageCard':
      case 'backgroundImage':
      case 'maskedImage':
      case 'productImage':
        return createImageHeroCard(type, props, action, tokens);
      case 'travelHeroScreen':
      case 'travelHeroCard':
        return createTravelHeroScreen(props, action, tokens);
      case 'travelDiscoverScreen':
      case 'travelDetailScreen':
        return createTravelDetailScreen(type, props, action, tokens);
      case 'propertySearchScreen':
      case 'propertyHeroCard':
      case 'propertyDetailCard':
      case 'apartmentCard':
        return createPropertyScreen(type, props, action, tokens);
      case 'beverageHeroScreen':
      case 'beverageProductCard':
        return createBeverageHeroScreen(props, action, tokens);
      case 'flavorVariationStrip':
      case 'galleryStrip':
        return createGalleryStrip(type, props, action, tokens);
      case 'productHeroScreen':
      case 'ecommerceHeroProduct':
      case 'productHeroCard':
        return createProductHeroScreen(props, action, tokens);
      case 'productGrid':
        return createProductGrid(props, action, tokens);
      case 'meditationHeroScreen':
      case 'meditationHeroImage':
        return createMeditationHeroScreen(props, action, tokens);
      case 'audioPlayerCard':
      case 'playerControl':
        return createAudioPlayerCard(props, action, tokens);
      case 'audioTrackList':
      case 'meditationTrackList':
        return createTrackList(type, props, action, tokens);
      case 'moodTabBar':
        return createCategoryChips(props, action, tokens);
      case 'creditCardPreview':
        return createCreditCardPreview(props, action, tokens);
      case 'toggleRow':
        return createToggleRow(props, action, tokens);
      case 'progressBar':
        return createProgressBar(props, action, tokens);
      case 'categoryRow':
        return createCategoryRow(props, action, tokens);
      case 'budgetGauge':
        return createBudgetGauge(props, action, tokens);
      case 'controlButton':
        return createControlButton(props, action, tokens);
      case 'insightCard':
        return createInsightCard(props, action, tokens);
      case 'securitySettingRow':
        return createSecuritySettingRow(props, action, tokens);
      case 'sidebar':
        return createSidebar(props, action, tokens);
      case 'splitView':
        return createSplitView(props, action, tokens);
      case 'cardGrid':
        return createCardGrid(props, action, tokens);
      case 'mediaCard':
      case 'bookCard':
      case 'productCard':
        return createMediaCard(props, action, tokens);
      case 'progressCard':
        return createProgressCard(props, action, tokens);
      case 'destinationCard':
      case 'destinationHeroCard':
        return createDestinationCard(type, props, action, tokens);
      case 'moodCheckInCard':
      case 'journalPromptCard':
        return createMoodJournalCard(type, props, action, tokens);
      case 'instructorCard':
        return createInstructorCard(props, action, tokens);
      case 'textField':
      case 'inputField':
        return createInputField(props, action, tokens);
      case 'primaryCTA':
      case 'primaryButton':
      case 'secondaryButton':
      case 'softPrimaryButton':
      case 'pillPrimaryButton':
      case 'pillSecondaryButton':
      case 'bookingCTA':
      case 'addToCartCTA':
      case 'skipLink':
      case 'socialButton':
        return createPrimaryCTA(type, props, action, tokens);
      case 'textLink':
        return createTextLink(props, action, tokens);
      case 'editorialHeadline':
      case 'bodyCopy':
        return createTextHeadline(type, props, action, tokens);
      case 'editorialIllustrationBlock':
      case 'lineArtIllustration':
      case 'headerIcon':
        return createIllustrationBlock(type, props, action, tokens);
      case 'amenityRow':
        return createAmenityRow(props, action, tokens);
      case 'productDetailPanel':
        return createProductDetailPanel(props, action, tokens);
      case 'onboardingScreen':
        return createOnboardingScreen(props, action, tokens);
      default:
        // Fallback for unimplemented components: just a simple card with a label
        return createGenericComponent(type, action, tokens);
    }
  },
};

function transparentTextStyle(
  fontSize: number,
  fontWeight: string | undefined,
  color: string,
  textAlign?: string,
): NodeStyle {
  return makeStyle({
    fill: '#00000000',
    fontSize,
    fontWeight,
    textColor: color,
    textAlign,
  });
}

function flexibleNumber(rawValue: string | undefined): number | undefined {
  if (rawValue === undefined) return undefined;
  const cleaned = trimWhitespacesAndNewlines(rawValue)
    .replaceAll('px', '')
    .replaceAll('pt', '')
    .replaceAll(',', '.');

  if (cleaned.length === 0) return undefined;
  if (['auto', 'fit', 'hug', 'fill', 'null'].includes(cleaned.toLowerCase())) return undefined;
  const value = swiftDouble(cleaned);
  if (value === null) return undefined;

  return value;
}

/// Largest font (≤ maxSize) at which `text` fits in `maxLines` lines of the
/// given width — so a long headline scales down instead of overflowing its
/// fixed box onto whatever sits below it. Bold glyphs average ~0.58em wide.
function fittingFontSize(text: string, width: number, maxSize: number, minSize: number, maxLines: number = 1): number {
  if (!(width > 0) || text.length === 0) return minSize;
  const measurer = getTextMeasurer();
  // stride(from: maxSize, through: minSize, by: -0.5)
  for (let index = 0; ; index += 1) {
    const candidate = maxSize + index * -0.5;
    if (candidate < minSize) break;
    if (maxLines <= 1) {
      const measured = measurer.width(text, candidate, 'semibold');
      if (measured <= width) return candidate;
    } else {
      const height = measurer.wrappedHeight(text, width, candidate, 'semibold');
      const allowedHeight = Math.ceil(measurer.fontBoundingHeight(candidate, 'semibold') * maxLines) + 2;
      if (Math.ceil(height) <= allowedHeight) return candidate;
    }
  }
  return minSize;
}

function humanizedComponentName(rawName: string): string {
  const cleaned = rawName.replaceAll('_', ' ').replaceAll('-', ' ');
  const words: string[] = [];
  let current = '';

  for (const scalar of cleaned) {
    if (/\s/u.test(scalar)) {
      if (current.length > 0) {
        words.push(current);
        current = '';
      }
    } else if (/\p{Lu}/u.test(scalar) && current.length > 0) {
      words.push(current);
      current = scalar;
    } else {
      current += scalar;
    }
  }

  if (current.length > 0) {
    words.push(current);
  }

  const title = words
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(' ');

  return title.length === 0 ? 'Custom Section' : title;
}

function createAvatarGreetingHeader(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = action.height ?? 72;
  const greeting = prop(props, 'greeting') ?? 'Welcome back';
  const name = prop(props, 'name') ?? prop(props, 'title') ?? "Today's focus";
  const titleWidth = w - 112;
  const titleSize = fittingFontSize(name, titleWidth, 24, 18);

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Avatar Greeting Header',
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({ fill: '#00000000' }),
    children: [
      makeDesignNode({
        type: 'Rectangle',
        name: 'Avatar',
        x: 0,
        y: 8,
        width: 48,
        height: 48,
        style: makeStyle({
          fill: tokens.colors.surfaceSecondary,
          cornerRadius: 24,
          opacity: 1.0,
        }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Greeting',
        x: 64,
        y: 8,
        width: titleWidth,
        height: 20,
        text: greeting,
        style: transparentTextStyle(
          tokens.typography.caption.fontSize,
          'regular',
          tokens.colors.textSecondary,
        ),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Title',
        x: 64,
        y: 30,
        width: titleWidth,
        height: 32,
        text: name,
        style: transparentTextStyle(titleSize, 'bold', tokens.colors.textPrimary),
        textBehavior: { wrap: false, autoHeight: false, maxLines: 1, truncate: false },
      }),
      makeDesignNode({
        type: 'Icon',
        name: 'Notification Icon',
        x: w - 40,
        y: 16,
        width: 32,
        height: 32,
        iconName: 'bell',
        style: makeStyle({
          fill: '#00000000',
          textColor: tokens.colors.textPrimary,
        }),
      }),
    ],
  });
}

function createBalanceHeroCard(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 326;
  const h = action.height ?? 168;

  const currency = prop(props, 'currency') ?? 'USD';
  const balance = prop(props, 'balance') ?? prop(props, 'amount') ?? '$12,480.65';
  const change = prop(props, 'change') ?? prop(props, 'delta') ?? '+2.4% this month';

  const card = makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Balance Hero Card',
    x: action.x ?? 32,
    y: action.y ?? 112,
    width: w,
    height: h,
    style: makeStyle({
      fill: tokens.colors.accentPrimary,
      cornerRadius: tokens.radius.lg,
      opacity: 1.0,
      shadow: { color: '#0F172A', opacity: 0.12, radius: 24, x: 0, y: 14 },
    }),
    children: [
      makeDesignNode({
        type: 'Text',
        name: 'Currency Label',
        x: tokens.spacing.lg,
        y: tokens.spacing.lg,
        width: 100, height: 24,
        text: currency,
        style: makeStyle({
          fill: '#00000000',
          fontSize: tokens.typography.body.fontSize,
          fontWeight: 'medium',
          textColor: '#FFFFFF',
        }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Balance',
        x: tokens.spacing.lg,
        y: tokens.spacing.lg + 32,
        width: w - tokens.spacing.lg * 2, height: 48,
        text: balance,
        style: makeStyle({
          fill: '#00000000',
          fontSize: tokens.typography.title1.fontSize,
          fontWeight: 'bold',
          textColor: '#FFFFFF',
        }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Change',
        x: tokens.spacing.lg,
        y: h - tokens.spacing.lg - 24,
        width: 100, height: 24,
        text: change,
        style: makeStyle({
          fill: '#00000000',
          fontSize: tokens.typography.body.fontSize,
          fontWeight: 'medium',
          textColor: '#DCEBFF',
        }),
      }),
    ],
  });
  return card;
}

function createTransactionRow(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = 72;

  const title = prop(props, 'title') ?? 'Transaction';
  const subtitle = prop(props, 'subtitle') ?? 'Today';
  const amount = prop(props, 'amount') ?? prop(props, 'value') ?? '-$42.30';
  const iconName = prop(props, 'icon') ?? 'cart.fill';

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Transaction Row',
    x: action.x ?? 16, y: action.y ?? 16,
    width: w, height: h,
    style: makeStyle({ fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.md, opacity: 1.0 }),
    children: [
      makeDesignNode({
        type: 'Icon',
        name: 'Icon',
        x: 16, y: 16,
        width: 40, height: 40,
        iconName,
        style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: 20, opacity: 1.0, textColor: tokens.colors.accentPrimary }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Title',
        x: 72, y: 16,
        width: 200, height: 24,
        text: title,
        style: makeStyle({ fill: '#00000000', fontSize: tokens.typography.body.fontSize, fontWeight: 'semibold', textColor: tokens.colors.textPrimary }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Subtitle',
        x: 72, y: 40,
        width: 200, height: 16,
        text: subtitle,
        style: makeStyle({ fill: '#00000000', fontSize: tokens.typography.caption.fontSize, fontWeight: 'regular', textColor: tokens.colors.textSecondary }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Amount',
        x: w - 116, y: 24,
        width: 100, height: 24,
        text: amount,
        style: makeStyle({ fill: '#00000000', fontSize: tokens.typography.body.fontSize, fontWeight: 'semibold', textColor: tokens.colors.textPrimary }),
      }),
    ],
  });
}

function createTransactionList(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = action.height ?? 232;
  // Rows are model-overridable (item1Title/item1Subtitle/item1Amount …);
  // the defaults are neutral activity, NOT Apple/Tesla stock tickers that
  // turned every "Recent activity" list into a trading app.
  const row = (
    i: number, dTitle: string, dSub: string, dAmt: string, icon: string, bg: string, fg: string,
  ): [string, string, string, string, string, string] => [
    prop(props, `item${i}Title`) ?? prop(props, `item${i}`) ?? dTitle,
    prop(props, `item${i}Subtitle`) ?? dSub,
    prop(props, `item${i}Amount`) ?? dAmt,
    prop(props, `item${i}Icon`) ?? icon, bg, fg,
  ];
  const rows = [
    row(1, 'Recent order', '2 items', '$189.00', 'bag.fill', '#DCFCE7', tokens.colors.accentPrimary),
    row(2, 'Delivered', 'Last week', '', 'shippingbox.fill', '#DBEAFE', '#2563EB'),
    row(3, 'Saved for later', 'Wishlist', '', 'heart.fill', '#FEE2E2', '#DC2626'),
  ];
  const rowHeight = 52;
  const rowGap = 10;

  const listTitle = prop(props, 'title') ?? 'Recent activity';
  const children: DesignNode[] = [
    makeDesignNode({
      type: 'Text',
      name: 'List Title',
      x: 18,
      y: 16,
      width: w - 108,
      height: 24,
      text: listTitle,
      style: transparentTextStyle(
        fittingFontSize(listTitle, w - 108, 18, 14),
        'bold',
        tokens.colors.textPrimary,
      ),
      textBehavior: { wrap: false, autoHeight: false, maxLines: 1, truncate: false },
    }),
    makeDesignNode({
      type: 'Text',
      name: 'List Action',
      x: w - 88,
      y: 18,
      width: 70,
      height: 20,
      text: prop(props, 'action') ?? 'See all',
      style: transparentTextStyle(12, 'semibold', tokens.colors.accentPrimary),
    }),
  ];

  rows.forEach((r, index) => {
    const y = index * (rowHeight + rowGap) + 52;
    const amountWidth = r[2].length === 0 ? 0 : Math.min(104, Math.max(48, charCount(r[2]) * 8));
    const textWidth = Math.max(108, w - 72 - amountWidth - (amountWidth > 0 ? 16 : 18));
    children.push(
      makeDesignNode({
        type: 'Rectangle',
        name: `${r[0]} Icon Background`,
        x: 18,
        y: y + 6,
        width: 40,
        height: 40,
        style: makeStyle({ fill: r[4], cornerRadius: 20, opacity: 1.0 }),
      }),
      makeDesignNode({
        type: 'Icon',
        name: `${r[0]} Icon`,
        x: 27,
        y: y + 15,
        width: 22,
        height: 22,
        iconName: r[3],
        style: makeStyle({ fill: '#00000000', textColor: r[5] }),
      }),
      makeDesignNode({
        type: 'Text',
        name: `${r[0]} Name`,
        x: 72,
        y: y + 6,
        width: textWidth,
        height: 22,
        text: r[0],
        style: transparentTextStyle(
          fittingFontSize(r[0], textWidth, 15, 11),
          'semibold',
          tokens.colors.textPrimary,
        ),
        textBehavior: { wrap: false, autoHeight: false, maxLines: 1, truncate: false },
      }),
      makeDesignNode({
        type: 'Text',
        name: `${r[0]} Detail`,
        x: 72,
        y: y + 30,
        width: textWidth,
        height: 18,
        text: r[1],
        style: transparentTextStyle(
          fittingFontSize(r[1], textWidth, 12, 10),
          undefined,
          tokens.colors.textSecondary,
        ),
        textBehavior: { wrap: false, autoHeight: false, maxLines: 1, truncate: false },
      }),
      makeDesignNode({
        type: 'Text',
        name: `${r[0]} Amount`,
        x: w - 18 - amountWidth,
        y: y + 18,
        width: amountWidth,
        height: 22,
        text: r[2],
        style: transparentTextStyle(
          fittingFontSize(r[2], Math.max(1, amountWidth), 14, 10),
          'bold',
          r[5],
          'right',
        ),
        textBehavior: { wrap: false, autoHeight: false, maxLines: 1, truncate: false },
      }),
    );
  });

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Transaction List',
    x: action.x ?? 16,
    y: action.y ?? 420,
    width: w,
    height: h,
    style: makeStyle({
      fill: tokens.colors.surfacePrimary,
      cornerRadius: tokens.radius.lg,
      opacity: 1.0,
      shadow: { color: '#0F172A', opacity: 0.06, radius: 18, x: 0, y: 10 },
    }),
    children,
  });
}

function createQuickActionRow(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = action.height ?? 96;
  // Prefer the model's own labels — it puts them in a comma list under an
  // advertised key (subtitle/text). Only fall back if it gave none, and
  // to GENERIC labels, not Buy/Sell/Deposit/Transfer that made every app
  // look like a banking app.
  const providedRaw = prop(props, 'actions') ?? prop(props, 'items') ?? prop(props, 'categories') ?? prop(props, 'subtitle') ?? prop(props, 'text');
  const provided = providedRaw === undefined
    ? undefined
    : swiftSplit(providedRaw, ',').map((part) => trimWhitespaces(part)).filter((part) => part.length > 0);
  const fallback = [prop(props, 'first'), prop(props, 'second'), prop(props, 'third'), prop(props, 'fourth')]
    .filter((value): value is string => value !== undefined);
  const labels: string[] = (() => {
    if (provided !== undefined && provided.length >= 2) return provided.slice(0, 4);
    if (fallback.length >= 2) return fallback;
    return ['Shop', 'Search', 'Saved', 'Account'];
  })();
  const icons = labels.map((label) => quickActionIcon(label));
  const horizontalPadding = 4;
  const itemWidth = (w - horizontalPadding * 2) / labels.length;

  const children: DesignNode[] = labels.flatMap((label, index) => {
    const x = horizontalPadding + index * itemWidth;
    return [
      makeDesignNode({
        type: 'Rectangle',
        name: `${label} Icon Background`,
        x: x + (itemWidth - 56) / 2,
        y: 4,
        width: 56,
        height: 56,
        style: makeStyle({
          fill: tokens.colors.accentPrimary + '1F',
          cornerRadius: 28,
          opacity: 1.0,
        }),
      }),
      makeDesignNode({
        type: 'Icon',
        name: `${label} Icon`,
        x: x + (itemWidth - 28) / 2,
        y: 18,
        width: 28,
        height: 28,
        iconName: icons[index],
        style: makeStyle({
          fill: '#00000000',
          textColor: tokens.colors.accentPrimary,
        }),
      }),
      makeDesignNode({
        type: 'Text',
        name: `${label} Label`,
        x: x + 2,
        y: 66,
        width: Math.max(40, itemWidth - 4),
        height: 34,
        text: label,
        style: transparentTextStyle(
          fittingFontSize(label, Math.max(40, itemWidth - 8), 13, 10, 2),
          'semibold',
          tokens.colors.textPrimary,
          'center',
        ),
        textBehavior: { wrap: true, autoHeight: false, maxLines: 2, truncate: false },
      }),
    ];
  });

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Quick Action Row',
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({ fill: '#00000000' }),
    children,
  });
}

/// Maps an action/category label to a fitting SF Symbol, with a neutral
/// grid fallback so a store's "Running / Lifestyle" never shows a bank's
/// transfer arrows.
function quickActionIcon(label: string): string {
  const l = label.toLowerCase();
  const map: [string, string][] = [
    ['pause', 'pause.fill'], ['split', 'flag.checkered'], ['lap', 'flag.checkered'],
    ['mute', 'speaker.slash.fill'], ['audio', 'speaker.wave.2.fill'],
    ['finish', 'stop.fill'], ['stop', 'stop.fill'],
    ['gps', 'location.fill'], ['heart', 'heart.fill'], ['sensor', 'applewatch'],
    ['coach', 'figure.strengthtraining.traditional'],
    ['improve', 'chart.line.uptrend.xyaxis'], ['progress', 'chart.line.uptrend.xyaxis'],
    ['shop', 'bag.fill'], ['buy', 'bag.fill'], ['cart', 'cart.fill'], ['store', 'storefront.fill'],
    ['search', 'magnifyingglass'], ['discover', 'safari.fill'], ['explore', 'safari.fill'],
    ['wishlist', 'heart.fill'], ['saved', 'heart.fill'], ['save', 'heart'], ['favorite', 'star.fill'],
    ['account', 'person.fill'], ['profile', 'person.fill'], ['setting', 'gearshape.fill'],
    ['run', 'figure.run'], ['training', 'dumbbell.fill'], ['workout', 'dumbbell.fill'], ['lifestyle', 'sparkles'],
    ['sell', 'arrow.down.left'], ['deposit', 'plus'], ['transfer', 'arrow.left.arrow.right'], ['send', 'paperplane.fill'],
    ['home', 'house.fill'], ['order', 'shippingbox.fill'], ['track', 'location.fill'], ['deliver', 'shippingbox.fill'],
    ['men', 'figure.stand'], ['women', 'figure.stand.dress'], ['kid', 'figure.child'],
    ['new', 'sparkles'], ['sale', 'tag.fill'], ['categor', 'square.grid.2x2.fill'], ['gift', 'gift.fill'],
  ];
  for (const [key, icon] of map) {
    if (l.includes(key)) return icon;
  }
  return 'circle.grid.2x2.fill';
}

function createCurrencyCardGrid(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = action.height ?? 156;
  const gap = 12;
  const cardWidth = (w - gap) / 2;
  const items: [string, string, string, string, string][] = [
    ['NVDA', '+2.4%', '$128.44', '#EEF2FF', '#4F46E5'],
    ['BTC', '+1.8%', '$64,210', '#FFF7ED', '#EA580C'],
  ];

  const cards: DesignNode[] = items.map((item, index) => {
    const x = index * (cardWidth + gap);
    return makeDesignNode({
      type: 'Frame',
      name: `${item[0]} Card`,
      x,
      y: 0,
      width: cardWidth,
      height: h,
      style: makeStyle({
        fill: tokens.colors.surfacePrimary,
        cornerRadius: tokens.radius.lg,
        opacity: 1.0,
        shadow: { color: '#0F172A', opacity: 0.06, radius: 16, x: 0, y: 8 },
      }),
      children: [
        makeDesignNode({
          type: 'Rectangle',
          name: `${item[0]} Badge`,
          x: 16,
          y: 16,
          width: 44,
          height: 44,
          style: makeStyle({ fill: item[3], cornerRadius: 22, opacity: 1.0 }),
        }),
        makeDesignNode({
          type: 'Text',
          name: `${item[0]} Symbol`,
          x: 16,
          y: 74,
          width: cardWidth - 32,
          height: 24,
          text: item[0],
          style: transparentTextStyle(17, 'bold', tokens.colors.textPrimary),
        }),
        makeDesignNode({
          type: 'Text',
          name: `${item[0]} Value`,
          x: 16,
          y: 102,
          width: cardWidth - 32,
          height: 24,
          text: item[2],
          style: transparentTextStyle(15, 'semibold', tokens.colors.textPrimary),
        }),
        makeDesignNode({
          type: 'Text',
          name: `${item[0]} Change`,
          x: cardWidth - 66,
          y: 24,
          width: 50,
          height: 18,
          text: item[1],
          style: transparentTextStyle(12, 'bold', '#16A34A'),
        }),
      ],
    });
  });

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Market Cards',
    x: action.x ?? 16,
    y: action.y ?? 664,
    width: w,
    height: h,
    style: makeStyle({ fill: '#00000000' }),
    children: cards,
  });
}

function createChartCard(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = action.height ?? 220;
  const title = prop(props, 'title') ?? 'Activity';
  const period = prop(props, 'period') ?? prop(props, 'subtitle');

  // A real bar chart, composed from primitives — so it renders correctly
  // on the canvas, in the web export and in the SwiftUI export with no
  // new node type. (This used to be an empty grey "Chart Placeholder"
  // box, the most obvious "unfinished" tell in generated apps.)
  const parsedValues: number[] = swiftSplit(prop(props, 'values') ?? '', ',')
    .map((part) => swiftDouble(trimWhitespaces(part)))
    .filter((value): value is number => value !== null)
    .filter((value) => value > 0);
  const values: number[] = parsedValues.length === 0
    ? [0.45, 0.62, 0.38, 0.80, 0.55, 0.72, 0.90]
    : parsedValues;
  const labelsRaw = prop(props, 'labels');
  const labels = labelsRaw !== undefined
    ? swiftSplit(labelsRaw, ',').map((part) => trimWhitespaces(part))
    : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const chartTop = period === undefined ? 56 : 74;
  const labelStrip = 18;
  const plotHeight = Math.max(40, h - chartTop - 16 - labelStrip);
  const plotWidth = w - 32;
  const maxValue = values.length === 0 ? 1 : Math.max(...values);
  const slot = plotWidth / Math.max(1, values.length);
  const barWidth = Math.min(slot * 0.55, 26);

  const children: DesignNode[] = [
    makeDesignNode({
      type: 'Text', name: 'Title',
      x: 16, y: 16, width: plotWidth, height: 24, text: title,
      style: makeStyle({
        fill: '#00000000', fontSize: tokens.typography.headline.fontSize,
        fontWeight: 'bold', textColor: tokens.colors.textPrimary,
      }),
    }),
  ];
  if (period !== undefined) {
    children.push(makeDesignNode({
      type: 'Text', name: 'Period',
      x: 16, y: 44, width: plotWidth, height: 18, text: period,
      style: makeStyle({
        fill: '#00000000', fontSize: tokens.typography.caption.fontSize,
        textColor: tokens.colors.textSecondary,
      }),
    }));
  }

  values.forEach((value, index) => {
    const ratio = Math.max(0.08, value / Math.max(maxValue, 0.0001));
    const barHeight = plotHeight * ratio;
    const x = 16 + slot * index + (slot - barWidth) / 2;
    // The most recent bar carries the accent; the rest are quiet.
    const isLatest = index === values.length - 1;
    children.push(makeDesignNode({
      type: 'Rectangle', name: `Bar ${index + 1}`,
      x, y: chartTop + (plotHeight - barHeight),
      width: barWidth, height: barHeight,
      style: makeStyle({
        fill: isLatest ? tokens.colors.accentPrimary : tokens.colors.surfaceSecondary,
        cornerRadius: Math.min(barWidth / 2, 8),
      }),
    }));
    if (index < labels.length) {
      children.push(makeDesignNode({
        type: 'Text', name: `Label ${index + 1}`,
        x: 16 + slot * index, y: chartTop + plotHeight + 4,
        width: slot, height: labelStrip - 2, text: labels[index],
        style: makeStyle({
          fill: '#00000000', fontSize: 10,
          textColor: tokens.colors.textSecondary, textAlign: 'center',
        }),
      }));
    }
  });

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Chart Card',
    x: action.x ?? 16, y: action.y ?? 16,
    width: w, height: h,
    style: makeStyle({ fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.lg, opacity: 1.0 }),
    children,
  });
}

function createPrimaryCTA(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = 56;
  const label = prop(props, 'label') ?? prop(props, 'title') ?? 'Continue';

  let fill = tokens.colors.accentPrimary;
  let textColor = tokens.colors.surfacePrimary;
  const radius = tokens.radius.pill;

  switch (type) {
    case 'secondaryButton':
    case 'pillSecondaryButton':
    case 'skipLink':
      fill = tokens.colors.surfaceSecondary;
      textColor = tokens.colors.textPrimary;
      break;
    case 'softPrimaryButton':
      fill = tokens.colors.surfaceSecondary;
      textColor = tokens.colors.accentPrimary;
      break;
    case 'socialButton':
      fill = '#000000';
      textColor = '#FFFFFF';
      break;
    default:
      break;
  }

  if (type === 'softPrimaryButton') {
    fill = tokens.colors.surfaceSecondary;
    textColor = tokens.colors.accentPrimary;
  }

  return makeDesignNode({
    type: 'Button',
    name: action.name ?? 'CTA Button',
    x: action.x ?? 16, y: action.y ?? 16,
    width: w, height: h,
    text: label,
    style: makeStyle({
      fill,
      cornerRadius: radius,
      opacity: 1.0,
      fontSize: tokens.typography.body.fontSize,
      fontWeight: 'bold',
      textColor,
    }),
    children: [],
  });
}

function createMetricCard(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 170;
  const h = action.height ?? 96;
  const title = prop(props, 'title') ?? prop(props, 'label') ?? type;
  const value = prop(props, 'value') ?? prop(props, 'amount') ?? '1,284';
  const subtitle = prop(props, 'subtitle') ?? prop(props, 'change') ?? 'Today';

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? title,
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({
      fill: tokens.colors.surfacePrimary,
      cornerRadius: tokens.radius.lg,
      opacity: 1.0,
      shadow: { color: '#0F172A', opacity: 0.06, radius: 18, x: 0, y: 10 },
    }),
    children: [
      makeDesignNode({
        type: 'Text',
        name: 'Metric Label',
        x: 14,
        y: 14,
        width: w - 28,
        height: 18,
        text: title,
        style: transparentTextStyle(
          tokens.typography.caption.fontSize,
          undefined,
          tokens.colors.textSecondary,
        ),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Metric Value',
        x: 14,
        y: 38,
        width: w - 28,
        height: 28,
        text: value,
        style: transparentTextStyle(
          tokens.typography.headline.fontSize,
          'bold',
          tokens.colors.textPrimary,
        ),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Metric Subtitle',
        x: 14,
        y: 70,
        width: w - 28,
        height: 18,
        text: subtitle,
        style: transparentTextStyle(
          tokens.typography.caption.fontSize,
          'semibold',
          tokens.colors.accentPrimary,
        ),
      }),
    ],
  });
}

function createBottomNavBar(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = action.height ?? 64;
  const label1 = prop(props, 'label1') ?? 'Home';
  const icon1 = prop(props, 'icon1') ?? 'house.fill';

  const label2 = prop(props, 'label2') ?? 'Discover';
  const icon2 = prop(props, 'icon2') ?? 'magnifyingglass';

  const label3 = prop(props, 'label3') ?? 'Favorites';
  const icon3 = prop(props, 'icon3') ?? 'heart.fill';

  const label4 = prop(props, 'label4') ?? 'Profile';
  const icon4 = prop(props, 'icon4') ?? 'person.fill';

  const labels = [label1, label2, label3, label4];
  const icons = [icon1, icon2, icon3, icon4];
  const rawActiveIndex = prop(props, 'activeIndex') ?? '1';
  const parsedActiveIndex = /^[+-]?\d+$/.test(rawActiveIndex) ? parseInt(rawActiveIndex, 10) : 1;
  const activeIndex = Math.max(0, Math.min(3, parsedActiveIndex - 1));
  const itemWidth = w / 4;

  const children: DesignNode[] = labels.flatMap((label, index) => {
    const x = index * itemWidth;
    return [
      makeDesignNode({
        type: 'Icon',
        name: `${label} Icon`,
        x: x + (itemWidth - 22) / 2,
        y: 10,
        width: 22,
        height: 22,
        iconName: icons[index],
        style: makeStyle({
          fill: '#00000000',
          textColor: index === activeIndex ? tokens.colors.accentPrimary : tokens.colors.textSecondary,
        }),
      }),
      makeDesignNode({
        type: 'Text',
        name: `${label} Label`,
        x,
        y: 36,
        width: itemWidth,
        height: 18,
        text: label,
        style: transparentTextStyle(
          11,
          index === activeIndex ? 'bold' : 'regular',
          index === activeIndex ? tokens.colors.accentPrimary : tokens.colors.textSecondary,
          'center',
        ),
      }),
    ];
  });

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Bottom Navigation',
    x: action.x ?? 16,
    y: action.y ?? 720,
    width: w,
    height: h,
    style: makeStyle({
      fill: tokens.colors.surfacePrimary,
      cornerRadius: tokens.radius.lg,
      opacity: 1.0,
    }),
    children,
  });
}

function createHeader(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const title = prop(props, 'title') ?? action.name ?? 'Overview';
  const subtitle = prop(props, 'subtitle') ?? 'Today';
  const w = action.width ?? 358;
  const titleSize = fittingFontSize(title, w, 26, 19);

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Header',
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: action.height ?? 72,
    style: makeStyle({ fill: '#00000000' }),
    children: [
      makeDesignNode({
        type: 'Text',
        name: 'Header Title',
        x: 0,
        y: 4,
        width: w,
        height: 34,
        text: title,
        style: transparentTextStyle(titleSize, 'bold', tokens.colors.textPrimary),
        textBehavior: { wrap: false, autoHeight: false, maxLines: 1, truncate: false },
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Header Subtitle',
        x: 0,
        y: 40,
        width: w,
        height: 20,
        text: subtitle,
        style: transparentTextStyle(
          tokens.typography.caption.fontSize,
          undefined,
          tokens.colors.textSecondary,
        ),
      }),
    ],
  });
}

function createContentCard(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = action.height ?? 132;
  const title = prop(props, 'title') ?? action.title ?? action.name ?? humanizedComponentName(action.rawComponentName ?? type);
  const subtitle = prop(props, 'subtitle') ?? prop(props, 'description') ?? 'A focused content section';
  const icon = prop(props, 'icon');

  const textX = icon !== undefined ? 64 : 18;

  const children: DesignNode[] = [];

  if (icon !== undefined) {
    children.push(
      makeDesignNode({
        type: 'Icon',
        name: 'Card Icon',
        x: 18,
        y: 20,
        width: 32,
        height: 32,
        iconName: icon,
        style: makeStyle({
          fill: '#00000000',
          textColor: tokens.colors.accentPrimary,
        }),
      }),
    );
  }

  children.push(
    makeDesignNode({
      type: 'Text',
      name: 'Card Title',
      x: textX,
      y: 18,
      width: w - textX - 18,
      height: 30,
      text: title,
      style: transparentTextStyle(
        fittingFontSize(title, w - textX - 18, tokens.typography.headline.fontSize, 15, 2),
        'bold',
        tokens.colors.textPrimary,
      ),
      textBehavior: { wrap: true, autoHeight: true, maxLines: 2, truncate: false },
    }),
    makeDesignNode({
      type: 'Text',
      name: 'Card Subtitle',
      x: textX,
      y: 56,
      width: w - textX - 18,
      height: 60,
      text: subtitle,
      style: transparentTextStyle(
        fittingFontSize(subtitle, w - textX - 18, tokens.typography.body.fontSize, 12, 3),
        undefined,
        tokens.colors.textSecondary,
      ),
      textBehavior: { wrap: true, autoHeight: true, maxLines: 3, truncate: false },
    }),
  );

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? title,
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({
      fill: tokens.colors.surfacePrimary,
      cornerRadius: tokens.radius.lg,
      opacity: 1.0,
      shadow: { color: '#0F172A', opacity: 0.07, radius: 18, x: 0, y: 10 },
    }),
    children,
  });
}

function createHeroCard(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 342;
  const h = action.height ?? 300;
  const title = prop(props, 'title') ?? action.title ?? action.name ?? 'Featured';
  const subtitle = prop(props, 'subtitle') ?? prop(props, 'description') ?? 'A beautiful highlighted moment';
  const image = prop(props, 'image') ?? prop(props, 'imageSource') ?? action.imageSource ?? action.imageName;
  const kicker = prop(props, 'kicker') ?? prop(props, 'eyebrow');
  const textColor = prop(props, 'textColor') ?? '#FFFFFF';
  const secondaryTextColor = prop(props, 'secondaryTextColor') ?? '#DDE6F8';
  const overlayColor = prop(props, 'overlayColor') ?? '#000000';
  const overlayOpacity = flexibleNumber(prop(props, 'overlayOpacity')) ?? 0.28;
  const radius = action.cornerRadius ?? tokens.radius.xl;

  const children: DesignNode[] = [];

  if (image !== undefined && trimWhitespacesAndNewlines(image).length > 0) {
    children.push(
      makeDesignNode({
        type: 'Image',
        name: 'Hero Image',
        x: 0,
        y: 0,
        width: w,
        height: h,
        imageName: image,
        imageSource: image,
        contentMode: 'fill',
        style: makeStyle({
          fill: tokens.colors.surfaceSecondary,
          cornerRadius: radius,
          opacity: 1.0,
          overlayColor,
          overlayOpacity,
        }),
      }),
    );
    children.push(
      makeDesignNode({
        type: 'Rectangle',
        name: 'Hero Text Overlay',
        x: 0,
        y: h * 0.42,
        width: w,
        height: h * 0.58,
        style: makeStyle({
          fill: overlayColor,
          cornerRadius: radius,
          opacity: 0.18,
          gradient: {
            type: 'linear',
            colors: ['#00000000', overlayColor],
            angle: 180,
            stops: [0, 1],
          },
        }),
      }),
    );
  } else {
    children.push(
      makeDesignNode({
        type: 'Rectangle',
        name: 'Hero Visual Field',
        x: 0,
        y: 0,
        width: w,
        height: h,
        style: makeStyle({
          fill: tokens.colors.surfacePrimary,
          cornerRadius: radius,
          opacity: 1.0,
          gradient: {
            type: 'linear',
            colors: [tokens.colors.accentPrimary, tokens.colors.accentPrimary + 'CC'],
            angle: 135,
            stops: [0, 1],
          },
        }),
      }),
    );
    children.push(
      makeDesignNode({
        type: 'Icon',
        name: 'Hero Symbol',
        x: w - 94,
        y: 28,
        width: 58,
        height: 58,
        iconName: prop(props, 'icon') ?? action.iconName ?? 'sparkles',
        style: makeStyle({ fill: '#00000000', textColor }),
      }),
    );
  }

  if (kicker !== undefined && kicker.length > 0) {
    children.push(
      makeDesignNode({
        type: 'Text',
        name: 'Hero Kicker',
        x: 24,
        y: Math.max(24, h - 134),
        width: w - 48,
        height: 18,
        text: kicker,
        style: transparentTextStyle(12, 'semibold', secondaryTextColor),
      }),
    );
  }

  children.push(
    makeDesignNode({
      type: 'Text',
      name: 'Hero Title',
      x: 24,
      y: h - 118,
      width: w - 48,
      height: 54,
      text: title,
      style: transparentTextStyle(
        // Shrink the font so a long title stays within its 50pt box
        // instead of wrapping down onto the subtitle.
        fittingFontSize(title, w - 48, Math.min(34, Math.max(24, tokens.typography.title1.fontSize - 4)), 18, 1),
        'bold',
        textColor,
      ),
      textBehavior: { wrap: true, autoHeight: true, maxLines: 2, truncate: false },
    }),
    makeDesignNode({
      type: 'Text',
      name: 'Hero Subtitle',
      x: 24,
      y: h - 58,
      width: w - 48,
      height: 42,
      text: subtitle,
      style: transparentTextStyle(
        fittingFontSize(subtitle, w - 48, Math.max(13, tokens.typography.caption.fontSize), 11, 2),
        'medium',
        secondaryTextColor,
      ),
      textBehavior: { wrap: true, autoHeight: true, maxLines: 2, truncate: false },
    }),
  );

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? title,
    x: action.x ?? 24,
    y: action.y ?? 120,
    width: w,
    height: h,
    style: makeStyle({
      fill: tokens.colors.surfacePrimary,
      cornerRadius: radius,
      opacity: action.opacity ?? 1.0,
      shadow: action.shadow ?? { color: '#000000', opacity: 0.20, radius: 28, x: 0, y: 18 },
    }),
    children,
  });
}

function createLargeIconTile(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  return makeLargeIconTile({
    props,
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: action.width ?? 156,
    height: action.height ?? 172,
    name: action.name,
    cornerRadius: action.cornerRadius,
    opacity: action.opacity,
    shadow: action.shadow,
    fallbackIcon: action.iconName,
    fallbackImage: action.imageSource,
    tokens,
  });
}

function makeLargeIconTile(init: {
  props: Props;
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  cornerRadius?: number;
  opacity?: number;
  shadow?: ShadowStyle;
  fallbackIcon?: string;
  fallbackImage?: string;
  tokens: DesignTokens;
}): DesignNode {
  const { props, x, y, name, cornerRadius, opacity, shadow, fallbackIcon, fallbackImage, tokens } = init;
  const w = init.width;
  const h = init.height;
  const title = prop(props, 'title') ?? prop(props, 'label') ?? name ?? 'Feature';
  const subtitle = prop(props, 'subtitle') ?? prop(props, 'description');
  const icon = prop(props, 'icon') ?? prop(props, 'iconName') ?? fallbackIcon ?? 'sparkles';
  const image = prop(props, 'image') ?? prop(props, 'imageSource') ?? fallbackImage;
  const accent = prop(props, 'accent') ?? prop(props, 'color') ?? tokens.colors.accentPrimary;
  const fill = prop(props, 'fill') ?? tokens.colors.surfacePrimary;
  const padding = 14;
  const visualSize = Math.min(Math.max(64, Math.min(w - padding * 2, h * 0.46)), 96);
  const visualX = (w - visualSize) / 2;
  const visualY = padding;
  const titleY = visualY + visualSize + 14;
  const subtitleY = titleY + 25;
  const titleHeight = subtitle === undefined ? 38 : 24;
  const subtitleHeight = Math.max(0, h - subtitleY - padding);

  const children: DesignNode[] = [];

  if (image !== undefined && trimWhitespacesAndNewlines(image).length > 0) {
    children.push(
      makeDesignNode({
        type: 'Image',
        name: 'Tile Image',
        x: visualX,
        y: visualY,
        width: visualSize,
        height: visualSize,
        imageName: image,
        imageSource: image,
        contentMode: 'fill',
        style: makeStyle({
          fill: tokens.colors.surfaceSecondary,
          cornerRadius: visualSize * 0.32,
          opacity: 1.0,
          shadow: { color: '#000000', opacity: 0.10, radius: 18, x: 0, y: 10 },
        }),
      }),
    );
  } else {
    children.push(
      makeDesignNode({
        type: 'Rectangle',
        name: 'Icon Background',
        x: visualX,
        y: visualY,
        width: visualSize,
        height: visualSize,
        style: makeStyle({
          fill: accent,
          cornerRadius: visualSize * 0.34,
          opacity: 0.14,
        }),
      }),
    );
    children.push(
      makeDesignNode({
        type: 'Icon',
        name: 'Feature Icon',
        x: visualX + visualSize * 0.26,
        y: visualY + visualSize * 0.26,
        width: visualSize * 0.48,
        height: visualSize * 0.48,
        iconName: icon,
        style: makeStyle({
          fill: '#00000000',
          textColor: accent,
        }),
      }),
    );
  }

  children.push(
    makeDesignNode({
      type: 'Text',
      name: 'Tile Title',
      x: padding,
      y: titleY,
      width: w - padding * 2,
      height: titleHeight,
      text: title,
      style: transparentTextStyle(
        w < 140 ? 14 : 16,
        'bold',
        tokens.colors.textPrimary,
      ),
    }),
  );

  if (subtitle !== undefined && subtitle.length > 0) {
    children.push(
      makeDesignNode({
        type: 'Text',
        name: 'Tile Subtitle',
        x: padding,
        y: subtitleY,
        width: w - padding * 2,
        height: Math.max(20, subtitleHeight),
        text: subtitle,
        style: transparentTextStyle(12, 'medium', tokens.colors.textSecondary),
      }),
    );
  }

  return makeDesignNode({
    type: 'Frame',
    name: name ?? title,
    x,
    y,
    width: w,
    height: h,
    style: makeStyle({
      fill,
      cornerRadius: cornerRadius ?? tokens.radius.lg,
      opacity: opacity ?? 1.0,
      shadow: shadow ?? { color: '#0F172A', opacity: 0.08, radius: 20, x: 0, y: 12 },
    }),
    children,
  });
}

function createIconFeatureGrid(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 342;
  const h = action.height ?? 360;
  const requestedColumns = flexibleNumber(prop(props, 'columns'));
  const columns = Math.max(1, Math.min(3, Math.trunc(requestedColumns ?? (w >= 360 ? 3 : 2))));
  const gap = flexibleNumber(prop(props, 'gap')) ?? 14;
  const padding = flexibleNumber(prop(props, 'padding')) ?? 0;
  const labels = [
    prop(props, 'firstTitle') ?? prop(props, 'first') ?? prop(props, 'title1') ?? prop(props, 'item1Title') ?? 'Discover',
    prop(props, 'secondTitle') ?? prop(props, 'second') ?? prop(props, 'title2') ?? prop(props, 'item2Title') ?? 'Track',
    prop(props, 'thirdTitle') ?? prop(props, 'third') ?? prop(props, 'title3') ?? prop(props, 'item3Title') ?? 'Create',
    prop(props, 'fourthTitle') ?? prop(props, 'fourth') ?? prop(props, 'title4') ?? prop(props, 'item4Title') ?? 'Share',
  ];
  const subtitles = [
    prop(props, 'firstSubtitle') ?? prop(props, 'subtitle1') ?? prop(props, 'item1Subtitle'),
    prop(props, 'secondSubtitle') ?? prop(props, 'subtitle2') ?? prop(props, 'item2Subtitle'),
    prop(props, 'thirdSubtitle') ?? prop(props, 'subtitle3') ?? prop(props, 'item3Subtitle'),
    prop(props, 'fourthSubtitle') ?? prop(props, 'subtitle4') ?? prop(props, 'item4Subtitle'),
  ];
  const icons = [
    prop(props, 'firstIcon') ?? prop(props, 'icon1') ?? prop(props, 'item1Icon') ?? 'sparkles',
    prop(props, 'secondIcon') ?? prop(props, 'icon2') ?? prop(props, 'item2Icon') ?? 'chart.line.uptrend.xyaxis',
    prop(props, 'thirdIcon') ?? prop(props, 'icon3') ?? prop(props, 'item3Icon') ?? 'plus',
    prop(props, 'fourthIcon') ?? prop(props, 'icon4') ?? prop(props, 'item4Icon') ?? 'square.and.arrow.up',
  ];
  const a1 = prop(props, 'firstAccent') ?? prop(props, 'accent1') ?? prop(props, 'item1Accent');
  const a2 = prop(props, 'secondAccent') ?? prop(props, 'accent2') ?? prop(props, 'item2Accent');
  const a3 = prop(props, 'thirdAccent') ?? prop(props, 'accent3') ?? prop(props, 'item3Accent');
  const a4 = prop(props, 'fourthAccent') ?? prop(props, 'accent4') ?? prop(props, 'item4Accent');

  const accents = [
    a1 ?? tokens.colors.accentPrimary,
    a2 ?? '#14B8A6',
    a3 ?? '#F97316',
    a4 ?? '#8B5CF6',
  ];

  const rows = Math.trunc(Math.ceil(labels.length / columns));
  const tileW = Math.max(96, (w - padding * 2 - gap * (columns - 1)) / columns);
  const tileH = Math.max(136, (h - padding * 2 - gap * (rows - 1)) / rows);

  const tiles: DesignNode[] = [];
  labels.forEach((label, index) => {
    const column = index % columns;
    const row = Math.trunc(index / columns);
    const tileProps: Record<string, string> = {
      title: label,
      subtitle: subtitles[index] ?? '',
      icon: icons[index],
      accent: accents[index],
      fill: prop(props, 'tileFill') ?? tokens.colors.surfacePrimary,
    };
    const tileX = padding + column * (tileW + gap);
    const tileY = padding + row * (tileH + gap);
    tiles.push(
      makeLargeIconTile({
        props: tileProps,
        x: tileX,
        y: tileY,
        width: tileW,
        height: tileH,
        name: label + ' Tile',
        tokens,
      }),
    );
  });

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Feature Grid',
    x: action.x ?? 24,
    y: action.y ?? 220,
    width: w,
    height: h,
    style: makeStyle({ fill: '#00000000' }),
    children: tiles,
  });
}

function createChatMessage(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 342;
  const h = action.height ?? 76;
  const role = (prop(props, 'role') ?? prop(props, 'sender') ?? action.name ?? 'assistant').toLowerCase();
  const isUser = role.includes('user') || role.includes('me');
  const text = prop(props, 'message') ?? prop(props, 'text') ?? (isUser ? 'Can you help me plan today?' : 'Absolutely. I can help you organize it.');
  const bubbleWidth = Math.min(w - 64, Math.max(180, charCount(text) * 7 + 44));
  const bubbleX = isUser ? w - bubbleWidth : 48;
  const bubbleFill = isUser ? tokens.colors.accentPrimary : tokens.colors.surfacePrimary;
  const bubbleText = isUser ? '#FFFFFF' : tokens.colors.textPrimary;

  const children: DesignNode[] = [];

  if (!isUser) {
    children.push(
      makeDesignNode({
        type: 'Rectangle',
        name: 'Assistant Avatar',
        x: 0,
        y: h - 40,
        width: 34,
        height: 34,
        style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: 17, opacity: 1.0 }),
      }),
    );
  }

  children.push(
    makeDesignNode({
      type: 'Frame',
      name: isUser ? 'User Bubble' : 'Assistant Bubble',
      x: bubbleX,
      y: 0,
      width: bubbleWidth,
      height: h,
      style: makeStyle({
        fill: bubbleFill,
        cornerRadius: 22,
        opacity: 1.0,
        shadow: { color: '#000000', opacity: 0.06, radius: 12, x: 0, y: 8 },
      }),
      children: [
        makeDesignNode({
          type: 'Text',
          name: 'Message Text',
          x: 16,
          y: 14,
          width: bubbleWidth - 32,
          height: h - 28,
          text,
          style: transparentTextStyle(15, 'regular', bubbleText),
        }),
      ],
    }),
  );

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? (isUser ? 'User Message' : 'AI Response'),
    x: action.x ?? 24,
    y: action.y ?? 120,
    width: w,
    height: h,
    style: makeStyle({ fill: '#00000000' }),
    children,
  });
}

function createChatInput(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 342;
  const h = action.height ?? 64;
  const placeholder = prop(props, 'placeholder') ?? prop(props, 'text') ?? 'Message...';

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Chat Input',
    x: action.x ?? 24,
    y: action.y ?? 748,
    width: w,
    height: h,
    style: makeStyle({
      fill: tokens.colors.surfacePrimary,
      cornerRadius: h / 2,
      opacity: 1.0,
      shadow: { color: '#000000', opacity: 0.12, radius: 22, x: 0, y: 12 },
    }),
    children: [
      makeDesignNode({
        type: 'Icon',
        name: 'Attach Icon',
        x: 18,
        y: 22,
        width: 20,
        height: 20,
        iconName: 'plus',
        style: makeStyle({ fill: '#00000000', textColor: tokens.colors.textSecondary }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Input Placeholder',
        x: 50,
        y: 21,
        width: w - 118,
        height: 22,
        text: placeholder,
        style: transparentTextStyle(15, undefined, tokens.colors.textSecondary),
      }),
      makeDesignNode({
        type: 'Frame',
        name: 'Send Button',
        x: w - 54,
        y: 10,
        width: 44,
        height: 44,
        style: makeStyle({ fill: tokens.colors.accentPrimary, cornerRadius: 22, opacity: 1.0 }),
        children: [
          makeDesignNode({
            type: 'Icon',
            name: 'Send Icon',
            x: 12,
            y: 12,
            width: 20,
            height: 20,
            iconName: 'arrow.up',
            style: makeStyle({ fill: '#00000000', textColor: '#FFFFFF' }),
          }),
        ],
      }),
    ],
  });
}

function createSearchBar(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 326;
  const h = action.height ?? 52;
  const placeholder = prop(props, 'placeholder') ?? prop(props, 'title') ?? 'Search';

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Search Bar',
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({
      fill: action.fill ?? tokens.colors.surfacePrimary,
      cornerRadius: action.cornerRadius ?? h / 2,
      opacity: action.opacity ?? 1.0,
      shadow: { color: '#0F172A', opacity: 0.06, radius: 14, x: 0, y: 8 },
    }),
    children: [
      makeDesignNode({
        type: 'Icon',
        name: 'Search Icon',
        x: 18,
        y: (h - 20) / 2,
        width: 20,
        height: 20,
        iconName: 'magnifyingglass',
        style: makeStyle({ fill: '#00000000', textColor: tokens.colors.textSecondary }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Search Placeholder',
        x: 48,
        y: (h - 22) / 2,
        width: w - 66,
        height: 22,
        text: placeholder,
        style: transparentTextStyle(15, 'medium', tokens.colors.textSecondary),
      }),
    ],
  });
}

function createCategoryChips(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 326;
  const h = action.height ?? 44;
  const providedRaw = prop(props, 'items') ?? prop(props, 'categories') ?? prop(props, 'subtitle');
  const provided = providedRaw === undefined
    ? undefined
    : swiftSplit(providedRaw, ',').map((part) => trimWhitespacesAndNewlines(part)).filter((part) => part.length > 0);
  const fallback = [prop(props, 'first'), prop(props, 'second'), prop(props, 'third')]
    .filter((value): value is string => value !== undefined);
  const labels = provided !== undefined && provided.length !== 0
    ? provided.slice(0, 3)
    : (fallback.length === 0 ? ['All', 'Trending', 'New'] : fallback);
  let currentX = 0;
  const chips = labels.map((label, index) => {
    const chipWidth = Math.min(Math.max(charCount(label) * 8 + 28, 64), 122);
    const x = currentX;
    currentX += chipWidth + 10;

    return makeDesignNode({
      type: 'Button',
      name: `${label} Chip`,
      x,
      y: 0,
      width: chipWidth,
      height: h,
      text: label,
      style: makeStyle({
        fill: index === 0 ? tokens.colors.accentPrimary : tokens.colors.surfacePrimary,
        cornerRadius: h / 2,
        opacity: 1.0,
        fontSize: 13,
        fontWeight: 'semibold',
        textColor: index === 0 ? '#FFFFFF' : tokens.colors.textPrimary,
        shadow: index === 0 ? { color: '#0F172A', opacity: 0.08, radius: 12, x: 0, y: 6 } : undefined,
      }),
    });
  });

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Category Chips',
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({ fill: '#00000000' }),
    children: chips,
  });
}

function createImageHeroCard(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 326;
  const h = action.height ?? 240;
  const image = prop(props, 'image') ?? prop(props, 'imageSource') ?? action.imageSource ?? action.imageName;
  const title = prop(props, 'title') ?? action.name ?? 'Hero Image';
  const subtitle = prop(props, 'subtitle') ?? prop(props, 'description') ?? '';
  const hasRealImage = image === undefined
    ? false
    : (() => {
      const lower = image.toLowerCase();
      return trimWhitespacesAndNewlines(image).length > 0
        && !lower.includes('placeholder') && !lower.includes('image prompt');
    })();

  const children: DesignNode[] = [];
  if (hasRealImage && image !== undefined) {
    children.push(
      makeDesignNode({
        type: 'Image',
        name: 'Hero Image',
        x: 0,
        y: 0,
        width: w,
        height: h,
        imageName: image,
        imageSource: image,
        contentMode: 'fill',
        style: makeStyle({
          fill: tokens.colors.surfaceSecondary,
          cornerRadius: action.cornerRadius ?? tokens.radius.lg,
          opacity: 1.0,
          overlayColor: '#07111F',
          overlayOpacity: 0.34,
        }),
      }),
    );
  } else {
    // No resolved asset: render an intentional branded illustration
    // instead of a grey missing-image glyph. This keeps the quality
    // floor high for text-only/low-cost models without pretending an
    // image was generated.
    children.push(
      makeDesignNode({
        type: 'Rectangle', name: 'Hero Brand Field',
        x: 0, y: 0, width: w, height: h,
        style: makeStyle({
          fill: tokens.colors.accentPrimary,
          cornerRadius: action.cornerRadius ?? tokens.radius.lg,
        }),
      }),
      makeDesignNode({
        type: 'Rectangle', name: 'Hero Orb Large',
        x: w - 126, y: -28, width: 156, height: 156,
        style: makeStyle({ fill: '#FFFFFF', cornerRadius: 78, opacity: 0.12 }),
      }),
      makeDesignNode({
        type: 'Rectangle', name: 'Hero Orb Small',
        x: w - 72, y: 94, width: 82, height: 82,
        style: makeStyle({ fill: '#FFFFFF', cornerRadius: 41, opacity: 0.09 }),
      }),
      makeDesignNode({
        type: 'Icon', name: 'Hero Symbol',
        x: 20, y: 22, width: 42, height: 42,
        iconName: prop(props, 'icon') ?? 'figure.run',
        style: makeStyle({ fill: '#00000000', textColor: '#FFFFFF' }),
      }),
    );
  }

  const titleWidth = w - 36;
  const titleSize = fittingFontSize(title, titleWidth, 26, 19, 2);
  children.push(
    makeDesignNode({
      type: 'Text',
      name: 'Hero Title',
      x: 18,
      y: h - (subtitle.length === 0 ? 82 : 120),
      width: titleWidth,
      height: subtitle.length === 0 ? 64 : 58,
      text: title,
      style: transparentTextStyle(titleSize, 'bold', '#FFFFFF'),
      textBehavior: { wrap: true, autoHeight: true, maxLines: 2, truncate: false },
    }),
  );
  if (subtitle.length !== 0) {
    children.push(
      makeDesignNode({
        type: 'Text',
        name: 'Hero Subtitle',
        x: 18,
        y: h - 58,
        width: titleWidth,
        height: 44,
        text: subtitle,
        style: transparentTextStyle(
          fittingFontSize(subtitle, titleWidth, 13, 11, 2),
          'medium',
          '#EAF2FF',
        ),
        textBehavior: { wrap: true, autoHeight: true, maxLines: 2, truncate: false },
      }),
    );
  }

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? type,
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({
      fill: tokens.colors.surfacePrimary,
      cornerRadius: action.cornerRadius ?? tokens.radius.lg,
      opacity: 1.0,
      shadow: action.shadow ?? { color: '#000000', opacity: 0.18, radius: 24, x: 0, y: 16 },
    }),
    children,
  });
}

function createTravelHeroScreen(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 260;
  const h = action.height ?? 560;
  const title = prop(props, 'title') ?? 'Explore Your Favorite Journey';
  const subtitle = prop(props, 'subtitle') ?? "Let's make our life better";
  const image = prop(props, 'image') ?? 'travel_forest';

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Travel Hero Screen',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({
      fill: '#294D2A',
      cornerRadius: 36,
      opacity: 1.0,
      shadow: { color: '#000000', opacity: 0.24, radius: 30, x: 0, y: 18 },
    }),
    children: [
      makeDesignNode({
        type: 'Image',
        name: 'Scenic Background',
        x: 0,
        y: 0,
        width: w,
        height: h,
        imageName: image,
        imageSource: image,
        contentMode: 'fill',
        style: makeStyle({
          fill: '#355E3B',
          cornerRadius: 36,
          opacity: 1.0,
          overlayColor: '#000000',
          overlayOpacity: 0.28,
        }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Hero Title',
        x: 22,
        y: 84,
        width: w - 44,
        height: 120,
        text: title,
        style: transparentTextStyle(34, 'bold', '#FFFFFF'),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Hero Subtitle',
        x: 22,
        y: 214,
        width: w - 44,
        height: 42,
        text: subtitle,
        style: transparentTextStyle(15, undefined, '#E8F3E1'),
      }),
      makeDesignNode({
        type: 'Button',
        name: 'Explore CTA',
        x: 22,
        y: h - 84,
        width: w - 44,
        height: 52,
        text: prop(props, 'cta') ?? 'Explore Now',
        style: makeStyle({
          fill: '#FFFFFF',
          cornerRadius: 26,
          opacity: 1.0,
          fontSize: 15,
          fontWeight: 'bold',
          textColor: '#1F3B22',
        }),
      }),
    ],
  });
}

function createTravelDetailScreen(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 260;
  const h = action.height ?? 560;
  const title = prop(props, 'title') ?? (type === 'travelDetailScreen' ? 'La Selva' : 'Discover');
  const subtitle = prop(props, 'location') ?? prop(props, 'subtitle') ?? 'Peru, South America';
  const image = prop(props, 'image') ?? 'travel_mountain';

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? type,
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: '#F9FAF6', cornerRadius: 36, opacity: 1.0, shadow: { color: '#000000', opacity: 0.18, radius: 28, x: 0, y: 18 } }),
    children: [
      createImageHeroCard(
        'imageHero',
        { title, image },
        makeDesignAction({ type: 'createComponent', x: 16, y: 20, width: w - 32, height: 250 }),
        tokens,
      ),
      makeDesignNode({
        type: 'Text',
        name: 'Detail Subtitle',
        x: 22,
        y: 288,
        width: w - 44,
        height: 24,
        text: subtitle,
        style: transparentTextStyle(13, undefined, '#60745F'),
      }),
      makeDesignNode({
        type: 'Frame',
        name: 'Detail Card',
        x: 16,
        y: 330,
        width: w - 32,
        height: 142,
        style: makeStyle({ fill: '#FFFFFF', cornerRadius: 26, opacity: 1.0, shadow: { color: '#000000', opacity: 0.10, radius: 18, x: 0, y: 10 } }),
        children: [
          makeDesignNode({ type: 'Text', name: 'Price', x: 18, y: 18, width: w - 68, height: 34, text: prop(props, 'price') ?? '$1270', style: transparentTextStyle(26, 'bold', '#102414') }),
          makeDesignNode({ type: 'Text', name: 'Body', x: 18, y: 60, width: w - 68, height: 54, text: 'Image-led destination details with soft cards and clear hierarchy.', style: transparentTextStyle(13, undefined, '#60745F') }),
        ],
      }),
    ],
  });
}

function createPropertyScreen(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 260;
  const h = action.height ?? 560;
  const title = prop(props, 'title') ?? 'Find The Perfect Place';
  const image = prop(props, 'image') ?? 'real_estate_building';

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? type,
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: '#E2E8F0', cornerRadius: 36, opacity: 1.0, shadow: { color: '#000000', opacity: 0.20, radius: 30, x: 0, y: 20 } }),
    children: [
      makeDesignNode({ type: 'Text', name: 'Property Title', x: 20, y: 34, width: w - 40, height: 84, text: title, style: transparentTextStyle(30, 'bold', '#0F172A') }),
      makeDesignNode({ type: 'Image', name: 'Property Image', x: 16, y: 132, width: w - 32, height: 230, imageName: image, imageSource: image, contentMode: 'fill', style: makeStyle({ fill: '#CBD5E1', cornerRadius: 28, opacity: 1.0, overlayColor: '#000000', overlayOpacity: 0.08 }) }),
      makeDesignNode({
        type: 'Frame', name: 'Glass Price Card', x: 28, y: 328, width: w - 56, height: 104,
        style: makeStyle({ fill: '#FFFFFF', cornerRadius: 24, opacity: 0.88, shadow: { color: '#000000', opacity: 0.12, radius: 20, x: 0, y: 12 } }),
        children: [
          makeDesignNode({ type: 'Text', name: 'Property Name', x: 16, y: 14, width: w - 88, height: 24, text: prop(props, 'property') ?? 'Opulence Apartment', style: transparentTextStyle(17, 'bold', '#0F172A') }),
          makeDesignNode({ type: 'Text', name: 'Property Price', x: 16, y: 48, width: w - 88, height: 34, text: prop(props, 'price') ?? '$1,280/mo', style: transparentTextStyle(25, 'bold', '#2563EB') }),
        ],
      }),
    ],
  });
}

function createBeverageHeroScreen(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 260;
  const h = action.height ?? 560;
  const title = prop(props, 'title') ?? 'Berry Juice';
  const image = prop(props, 'image') ?? 'berries_dark';

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Beverage Hero Screen',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: '#121111', cornerRadius: 36, opacity: 1.0, shadow: { color: '#000000', opacity: 0.26, radius: 34, x: 0, y: 20 } }),
    children: [
      makeDesignNode({ type: 'Image', name: 'Fruit Background', x: 0, y: 0, width: w, height: h, imageName: image, imageSource: image, contentMode: 'fill', style: makeStyle({ fill: '#23181D', cornerRadius: 36, opacity: 1.0, overlayColor: '#000000', overlayOpacity: 0.36 }) }),
      makeDesignNode({ type: 'Text', name: 'Brand Title', x: 20, y: 76, width: w - 40, height: 96, text: title, style: transparentTextStyle(40, 'bold', '#FFFFFF') }),
      makeDesignNode({ type: 'Text', name: 'Beverage Subtitle', x: 20, y: 180, width: w - 40, height: 42, text: prop(props, 'subtitle') ?? 'Fresh dark berry flavor', style: transparentTextStyle(15, undefined, '#F3DCE4') }),
      makeDesignNode({ type: 'Button', name: 'Price CTA', x: 20, y: h - 82, width: w - 40, height: 52, text: prop(props, 'cta') ?? 'Add to cart - $12', style: makeStyle({ fill: '#F43F5E', cornerRadius: 26, opacity: 1.0, fontSize: 15, fontWeight: 'bold', textColor: '#FFFFFF' }) }),
    ],
  });
}

function createProductHeroScreen(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 260;
  const h = action.height ?? 560;
  const title = prop(props, 'title') ?? 'New Arrivals';
  const image = prop(props, 'image') ?? 'headphones_pink';

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Product Hero Screen',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: '#FCE7F3', cornerRadius: 36, opacity: 1.0, shadow: { color: '#000000', opacity: 0.16, radius: 28, x: 0, y: 18 } }),
    children: [
      makeDesignNode({ type: 'Text', name: 'Product Title', x: 20, y: 46, width: w - 40, height: 82, text: title, style: transparentTextStyle(36, 'bold', '#111827') }),
      makeDesignNode({ type: 'Image', name: 'Product Image', x: 22, y: 144, width: w - 44, height: 230, imageName: image, imageSource: image, contentMode: 'fit', style: makeStyle({ fill: '#FDF2F8', cornerRadius: 32, opacity: 1.0, shadow: { color: '#EC4899', opacity: 0.16, radius: 28, x: 0, y: 18 } }) }),
      makeDesignNode({ type: 'Button', name: 'Add To Cart', x: 20, y: h - 82, width: w - 40, height: 52, text: prop(props, 'cta') ?? 'Add to Cart', style: makeStyle({ fill: '#EC4899', cornerRadius: 26, opacity: 1.0, fontSize: 15, fontWeight: 'bold', textColor: '#FFFFFF' }) }),
    ],
  });
}

function createMeditationHeroScreen(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 260;
  const h = action.height ?? 560;
  const title = prop(props, 'title') ?? 'Killing Anxiety';
  const image = prop(props, 'image') ?? 'meditation_landscape';

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Meditation Hero Screen',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: '#151827', cornerRadius: 36, opacity: 1.0, shadow: { color: '#000000', opacity: 0.24, radius: 32, x: 0, y: 20 } }),
    children: [
      makeDesignNode({ type: 'Image', name: 'Atmospheric Image', x: 0, y: 0, width: w, height: 300, imageName: image, imageSource: image, contentMode: 'fill', style: makeStyle({ fill: '#30364F', cornerRadius: 36, opacity: 1.0, overlayColor: '#000000', overlayOpacity: 0.32 }) }),
      makeDesignNode({ type: 'Text', name: 'Meditation Title', x: 22, y: 220, width: w - 44, height: 72, text: title, style: transparentTextStyle(32, 'bold', '#FFFFFF') }),
      createAudioPlayerCard(
        { title: prop(props, 'track') ?? 'Breathing Session' },
        makeDesignAction({ type: 'createComponent', x: 20, y: h - 154, width: w - 40, height: 112 }),
        tokens,
      ),
    ],
  });
}

function createAudioPlayerCard(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 220;
  const h = action.height ?? 96;

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Audio Player Card',
    x: action.x ?? 20,
    y: action.y ?? 20,
    width: w,
    height: h,
    style: makeStyle({ fill: '#FFFFFF', cornerRadius: 26, opacity: 0.16, shadow: { color: '#000000', opacity: 0.18, radius: 20, x: 0, y: 12 } }),
    children: [
      makeDesignNode({ type: 'Text', name: 'Track Title', x: 16, y: 16, width: w - 32, height: 24, text: prop(props, 'title') ?? 'Calm Session', style: transparentTextStyle(15, 'bold', '#FFFFFF') }),
      makeDesignNode({ type: 'Icon', name: 'Play', x: w / 2 - 18, y: h - 48, width: 36, height: 36, iconName: 'play.fill', style: makeStyle({ fill: '#A7F3D0', cornerRadius: 18, opacity: 1.0, textColor: '#151827' }) }),
    ],
  });
}

function createGalleryStrip(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 240;
  const h = action.height ?? 78;
  const images = [
    prop(props, 'image1') ?? 'travel_forest',
    prop(props, 'image2') ?? 'travel_mountain',
    prop(props, 'image3') ?? 'travel_lake',
  ];
  const itemWidth = (w - 20) / 3;

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? type,
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({ fill: '#00000000' }),
    children: images.map((image, index) => makeDesignNode({
      type: 'Image', name: `Gallery ${index + 1}`, x: index * (itemWidth + 10), y: 0, width: itemWidth, height: h,
      imageName: image, imageSource: image, contentMode: 'fill',
      style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: 18, opacity: 1.0 }),
    })),
  });
}

function createProductGrid(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 240;
  const h = action.height ?? 180;
  const itemWidth = (w - 12) / 2;

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Product Grid',
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({ fill: '#00000000' }),
    children: [0, 1].map((index) => makeProductGridCard(index, itemWidth, h)),
  });
}

function makeProductGridCard(index: number, itemWidth: number, height: number): DesignNode {
  const image = index === 0 ? 'headphones_pink' : 'product_detail';
  const title = index === 0 ? 'Air Soft' : 'Pulse Max';

  return makeDesignNode({
    type: 'Frame',
    name: `Product Card ${index + 1}`,
    x: index * (itemWidth + 12),
    y: 0,
    width: itemWidth,
    height,
    style: makeStyle({
      fill: '#FFFFFF',
      cornerRadius: 22,
      opacity: 1.0,
      shadow: { color: '#000000', opacity: 0.10, radius: 16, x: 0, y: 10 },
    }),
    children: [
      makeDesignNode({
        type: 'Image',
        name: 'Product Image',
        x: 12,
        y: 12,
        width: itemWidth - 24,
        height: 92,
        imageName: image,
        imageSource: image,
        contentMode: 'fit',
        style: makeStyle({ fill: '#FDF2F8', cornerRadius: 18, opacity: 1.0 }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Product Name',
        x: 12,
        y: 116,
        width: itemWidth - 24,
        height: 22,
        text: title,
        style: transparentTextStyle(13, 'bold', '#111827'),
      }),
    ],
  });
}

function createProgressRing(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const rawTitle = prop(props, 'title') ?? 'Goal';
  const progress = prop(props, 'progress') ?? '50%';
  const titleParts = swiftSplit(rawTitle, ':', 1).map((part) => trimWhitespacesAndNewlines(part));
  const title = titleParts.length > 0 ? titleParts[0] : rawTitle;
  const extractedValue = titleParts.length === 2 ? titleParts[1] : undefined;
  const fallbackValue: string = (() => {
    const trimmed = trimWhitespacesAndNewlines(progress);
    const numeric = swiftDouble(trimmed);
    if (numeric !== null && numeric >= 0 && numeric <= 1) {
      return `${swiftIntTruncating(swiftRounded(numeric * 100))}%`;
    }
    return trimmed;
  })();
  const displayValue = prop(props, 'value') ?? prop(props, 'amount') ?? extractedValue ?? fallbackValue;
  // A progress ring is a modest circle, NOT a full-width blob: the
  // composer passes the whole content width, which made a 350×350 disc
  // that swallowed the screen and overlapped its own labels. Cap the
  // diameter and centre it in the allotted width.
  const allotted = action.width ?? 200;
  const size = Math.min(action.height ?? 176, 176);
  const originX = (action.x ?? 32) + Math.max(0, (allotted - size) / 2);

  // A real ring, not a flat grey disc: an accent gradient outer circle, a
  // surface inner disc that carves the ring band, a coloured shadow for
  // depth, and centred value + label.
  const band = 14;
  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Progress Ring',
    x: originX,
    y: action.y ?? 120,
    width: size,
    height: size,
    style: makeStyle({ fill: '#00000000' }),
    children: [
      makeDesignNode({
        type: 'Rectangle', name: 'Ring Track',
        x: 0, y: 0, width: size, height: size,
        style: makeStyle({
          fill: tokens.colors.accentPrimary, cornerRadius: size / 2, opacity: 1.0,
          shadow: { color: tokens.colors.accentPrimary, opacity: 0.30, radius: 22, x: 0, y: 12 },
          gradient: {
            type: 'linear',
            colors: [tokens.colors.accentPrimary, tokens.colors.accentPrimary + 'B3'],
            angle: 135, stops: [0, 1],
          },
        }),
      }),
      makeDesignNode({
        type: 'Rectangle', name: 'Ring Inner',
        x: band, y: band, width: size - band * 2, height: size - band * 2,
        style: makeStyle({ fill: tokens.colors.surfacePrimary, cornerRadius: (size - band * 2) / 2, opacity: 1.0 }),
      }),
      makeDesignNode({
        type: 'Text', name: 'Progress Value',
        x: 10, y: size / 2 - 28, width: size - 20, height: 34, text: displayValue,
        style: transparentTextStyle(
          fittingFontSize(displayValue, size - 28, 30, 17),
          'bold',
          tokens.colors.accentPrimary,
          'center',
        ),
        textBehavior: { wrap: false, autoHeight: false, maxLines: 1, truncate: false },
      }),
      makeDesignNode({
        type: 'Text', name: 'Title',
        x: 12, y: size / 2 + 10, width: size - 24, height: 38, text: title,
        style: transparentTextStyle(
          fittingFontSize(title, size - 28, 12, 10, 2),
          'medium',
          tokens.colors.textSecondary,
          'center',
        ),
        textBehavior: { wrap: true, autoHeight: true, maxLines: 2, truncate: false },
      }),
    ],
  });
}

function createWorkoutCard(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 326;
  const h = action.height ?? 100;
  const title = prop(props, 'title') ?? 'Workout';
  const duration = prop(props, 'duration') ?? '30 min';
  const distance = prop(props, 'distance') ?? prop(props, 'value') ?? '';
  const intensity = prop(props, 'intensity') ?? prop(props, 'subtitle') ?? '';
  const status = prop(props, 'status') ?? prop(props, 'badge') ?? 'Ready';
  const facts = [duration, distance, intensity]
    .filter((fact) => trimWhitespacesAndNewlines(fact).length > 0)
    .join('  •  ');

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Workout Card',
    x: action.x ?? 32,
    y: action.y ?? 260,
    width: w,
    height: h,
    style: makeStyle({
      fill: tokens.colors.surfacePrimary,
      cornerRadius: tokens.radius.md,
      opacity: 1.0,
    }),
    children: [
      makeDesignNode({
        type: 'Rectangle', name: 'Workout Icon Background',
        x: 16, y: 16, width: 44, height: 44,
        style: makeStyle({ fill: tokens.colors.accentPrimary + '1F', cornerRadius: 22, opacity: 1.0 }),
      }),
      makeDesignNode({
        type: 'Icon', name: 'Workout Icon',
        x: 27, y: 27, width: 22, height: 22,
        iconName: prop(props, 'icon') ?? 'figure.run',
        style: makeStyle({ fill: '#00000000', textColor: tokens.colors.accentPrimary }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Title',
        x: 72,
        y: 14,
        width: w - 88, height: 48,
        text: title,
        style: makeStyle({
          fill: '#00000000',
          fontSize: fittingFontSize(title, w - 88, 18, 14, 2),
          fontWeight: 'bold',
          textColor: tokens.colors.textPrimary,
        }),
        textBehavior: { wrap: true, autoHeight: true, maxLines: 2, truncate: false },
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Workout Facts',
        x: 16,
        y: 76,
        width: w - 32, height: 20,
        text: facts,
        style: makeStyle({
          fill: '#00000000',
          fontSize: fittingFontSize(facts, w - 32, 13, 10),
          textColor: tokens.colors.textSecondary,
        }),
        textBehavior: { wrap: false, autoHeight: false, maxLines: 1, truncate: false },
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Workout Status',
        x: 16,
        y: 108,
        width: w - 32, height: 20,
        text: `● ${status}`,
        style: transparentTextStyle(12, 'semibold', tokens.colors.accentPrimary),
        textBehavior: { wrap: false, autoHeight: false, maxLines: 1, truncate: false },
      }),
    ],
  });
}

function createTrackList(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 326;
  const h = action.height ?? 260;
  const isMeditation = type === 'meditationTrackList';
  const title = prop(props, 'title') ?? action.name ?? (isMeditation ? 'For your evening' : 'Recently played');
  const rowTitle1 = prop(props, 'first') ?? prop(props, 'track1') ?? (isMeditation ? 'Deep Focus' : 'Neon Skyline');
  const rowTitle2 = prop(props, 'second') ?? prop(props, 'track2') ?? (isMeditation ? 'Quiet Breath' : 'After Hours');
  const rowTitle3 = prop(props, 'third') ?? prop(props, 'track3') ?? (isMeditation ? 'Soft Rain' : 'Velvet Bass');
  const rows: [string, string, string][] = [
    [rowTitle1, prop(props, 'firstMeta') ?? prop(props, 'meta1') ?? (isMeditation ? '8 min' : 'Luna Vale · 3:42'), prop(props, 'firstIcon') ?? prop(props, 'icon1') ?? 'play.fill'],
    [rowTitle2, prop(props, 'secondMeta') ?? prop(props, 'meta2') ?? (isMeditation ? '12 min' : 'The Motion · 4:08'), prop(props, 'secondIcon') ?? prop(props, 'icon2') ?? 'waveform'],
    [rowTitle3, prop(props, 'thirdMeta') ?? prop(props, 'meta3') ?? (isMeditation ? '5 min' : 'Mira North · 2:57'), prop(props, 'thirdIcon') ?? prop(props, 'icon3') ?? 'music.note'],
  ];
  const rowHeight = 54;

  const children: DesignNode[] = [
    makeDesignNode({
      type: 'Text',
      name: 'List Title',
      x: 18,
      y: 16,
      width: w - 36,
      height: 26,
      text: title,
      style: transparentTextStyle(18, 'bold', tokens.colors.textPrimary),
    }),
  ];

  rows.forEach((row, index) => {
    const y = index * (rowHeight + 8) + 54;
    children.push(
      makeDesignNode({
        type: 'Rectangle',
        name: `${row[0]} Icon Background`,
        x: 18,
        y,
        width: 44,
        height: 44,
        style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: 22, opacity: 1.0 }),
      }),
      makeDesignNode({
        type: 'Icon',
        name: `${row[0]} Icon`,
        x: 30,
        y: y + 12,
        width: 20,
        height: 20,
        iconName: row[2],
        style: makeStyle({ fill: '#00000000', textColor: tokens.colors.accentPrimary }),
      }),
      makeDesignNode({
        type: 'Text',
        name: `${row[0]} Title`,
        x: 76,
        y: y + 4,
        width: w - 142,
        height: 22,
        text: row[0],
        style: transparentTextStyle(15, 'semibold', tokens.colors.textPrimary),
      }),
      makeDesignNode({
        type: 'Text',
        name: `${row[0]} Meta`,
        x: 76,
        y: y + 28,
        width: w - 142,
        height: 18,
        text: row[1],
        style: transparentTextStyle(12, undefined, tokens.colors.textSecondary),
      }),
      makeDesignNode({
        type: 'Icon',
        name: `${row[0]} More`,
        x: w - 42,
        y: y + 12,
        width: 20,
        height: 20,
        iconName: 'chevron.right',
        style: makeStyle({ fill: '#00000000', textColor: tokens.colors.textSecondary }),
      }),
    );
  });

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Track List',
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({
      fill: action.fill ?? tokens.colors.surfacePrimary,
      cornerRadius: action.cornerRadius ?? tokens.radius.lg,
      opacity: action.opacity ?? 1.0,
      shadow: { color: '#0F172A', opacity: 0.07, radius: 18, x: 0, y: 10 },
    }),
    children,
  });
}

function createGenericComponent(type: ComponentType, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 260;
  const h = action.height ?? 128;
  const rawName = action.rawComponentName ?? type;
  const title = action.title ?? action.name ?? humanizedComponentName(rawName);
  const subtitle = action.descriptionText ?? prop(action.props, 'subtitle') ?? prop(action.props, 'description') ?? 'Key details';
  const iconName = action.iconName ?? prop(action.props, 'icon') ?? 'sparkles';
  const compact = h < 96;

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? title,
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({
      fill: action.fill ?? tokens.colors.surfacePrimary,
      cornerRadius: action.cornerRadius ?? tokens.radius.lg,
      opacity: action.opacity ?? 1.0,
      shadow: action.shadow ?? { color: '#000000', opacity: 0.08, radius: 18, x: 0, y: 10 },
    }),
    children: [
      makeDesignNode({
        type: 'Rectangle',
        name: 'Generic Icon Background',
        x: 16,
        y: 16,
        width: compact ? 36 : 44,
        height: compact ? 36 : 44,
        style: makeStyle({
          fill: tokens.colors.surfaceSecondary,
          cornerRadius: compact ? 18 : 22,
          opacity: 1.0,
        }),
      }),
      makeDesignNode({
        type: 'Icon',
        name: 'Generic Icon',
        x: compact ? 25 : 27,
        y: compact ? 25 : 27,
        width: compact ? 18 : 22,
        height: compact ? 18 : 22,
        iconName,
        style: makeStyle({
          fill: '#00000000',
          textColor: tokens.colors.accentPrimary,
        }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Generic Title',
        x: compact ? 64 : 74,
        y: compact ? 18 : 18,
        width: w - (compact ? 80 : 92),
        height: compact ? 24 : 28,
        text: title,
        style: transparentTextStyle(
          compact ? tokens.typography.body.fontSize : tokens.typography.headline.fontSize,
          'bold',
          tokens.colors.textPrimary,
        ),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Generic Subtitle',
        x: compact ? 64 : 74,
        y: compact ? 44 : 52,
        width: w - (compact ? 80 : 92),
        height: compact ? Math.max(20, h - 52) : Math.max(36, h - 68),
        text: subtitle,
        style: makeStyle({
          fill: '#00000000',
          fontSize: tokens.typography.caption.fontSize,
          textColor: tokens.colors.textSecondary,
        }),
      }),
    ],
  });
}

// MARK: - Banking / Fintech Components

function createCreditCardPreview(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 342;
  const h = action.height ?? 216;

  const cardNetwork = prop(props, 'network') ?? 'Visa';
  const cardNumber = prop(props, 'last4') ?? '••••  ••••  ••••  4281';
  const cardHolder = prop(props, 'holder') ?? 'Sarah Jenkins';
  const expiry = prop(props, 'expiry') ?? '12/28';
  const cardType = prop(props, 'type') ?? 'Credit';

  // Use provided gradient or fallback to token gradient
  const bgStyle = makeStyle({
    fill: '#00000000',
    cornerRadius: tokens.radius.lg,
    shadow: { color: '#000000', opacity: 0.15, radius: 24, x: 0, y: 12 },
    gradient: tokens.gradients?.creditCard ?? { type: 'linear', colors: ['#1A1B20', '#3E4150'], angle: 135, stops: [0, 1] },
  });

  return makeDesignNode({
    type: 'Frame',
    name: action.nodeReference ?? 'creditCardPreview',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: bgStyle,
    children: [
      makeDesignNode({
        type: 'Icon',
        name: 'Chip Icon',
        x: 24,
        y: 24,
        width: 32,
        height: 24,
        iconName: 'simcard.fill',
        style: makeStyle({ fill: '#00000000', fontSize: 24, textColor: '#E5C88F' }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Card Network',
        x: w - 80,
        y: 24,
        width: 56,
        height: 24,
        text: cardNetwork,
        style: transparentTextStyle(16, 'bold', '#FFFFFF'),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Card Number',
        x: 24,
        y: 88,
        width: w - 48,
        height: 32,
        text: cardNumber,
        style: makeStyle({ fill: '#00000000', fontSize: 22, fontWeight: 'bold', textColor: '#FFFFFF', letterSpacing: 2 }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Card Holder',
        x: 24,
        y: h - 56,
        width: w / 2,
        height: 24,
        text: cardHolder,
        style: transparentTextStyle(14, 'semibold', '#FFFFFF'),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Expiry',
        x: 24,
        y: h - 32,
        width: 60,
        height: 16,
        text: expiry,
        style: transparentTextStyle(12, undefined, '#9CA3AF'),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Card Type',
        x: w - 80,
        y: h - 32,
        width: 56,
        height: 16,
        text: cardType,
        style: transparentTextStyle(12, undefined, '#9CA3AF'),
      }),
    ],
  });
}

function createToggleRow(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 342;
  const h = action.height ?? 64;
  const title = prop(props, 'title') ?? 'Enable Setting';
  const subtitle = prop(props, 'subtitle') ?? prop(props, 'description');
  const isOn = (prop(props, 'isOn') ?? prop(props, 'value') ?? 'true').toLowerCase() === 'true';

  const toggleColor = isOn ? (tokens.colors.success ?? '#34D399') : tokens.colors.surfaceSecondary;
  const knobX = isOn ? 26 : 2;

  return makeDesignNode({
    type: 'Frame',
    name: action.nodeReference ?? 'toggleRow',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.md }),
    children: [
      makeDesignNode({
        type: 'Text',
        name: 'Title',
        x: 16,
        y: subtitle === undefined ? h / 2 - 10 : 12,
        width: w - 90,
        height: 20,
        text: title,
        style: transparentTextStyle(tokens.typography.body.fontSize, 'semibold', tokens.colors.textPrimary),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Subtitle',
        x: 16,
        y: 36,
        width: w - 90,
        height: 30,
        text: subtitle ?? '',
        style: transparentTextStyle(
          fittingFontSize(subtitle ?? '', w - 90, 12, 10, 2),
          undefined,
          tokens.colors.textSecondary,
        ),
        textBehavior: { wrap: true, autoHeight: true, maxLines: 2, truncate: false },
      }),
      makeDesignNode({
        type: 'Frame',
        name: 'Toggle Track',
        x: w - 66,
        y: h / 2 - 16,
        width: 50,
        height: 32,
        style: makeStyle({ fill: toggleColor, cornerRadius: 16 }),
        children: [
          makeDesignNode({
            type: 'Rectangle',
            name: 'Toggle Knob',
            x: knobX,
            y: 2,
            width: 28,
            height: 28,
            style: makeStyle({ fill: '#FFFFFF', cornerRadius: 14, shadow: { color: '#000000', opacity: 0.1, radius: 4, x: 0, y: 2 } }),
          }),
        ],
      }),
    ],
  });
}

function createProgressBar(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 342;
  const h = action.height ?? 48;
  const label = prop(props, 'label') ?? prop(props, 'title') ?? 'Progress';
  const progressRaw = prop(props, 'progress') ?? '0.5';
  const progressValue = swiftDouble(progressRaw) ?? 0.5;
  const rightLabel = prop(props, 'rightLabel') ?? prop(props, 'value') ?? `${swiftIntTruncating(progressValue * 100)}%`;

  const barWidth = w * progressValue;
  const barHeight = 8;

  return makeDesignNode({
    type: 'Frame',
    name: action.nodeReference ?? 'progressBar',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: '#00000000' }),
    children: [
      makeDesignNode({
        type: 'Text',
        name: 'Label',
        x: 0,
        y: 0,
        width: w / 2,
        height: 20,
        text: label,
        style: transparentTextStyle(tokens.typography.caption.fontSize, 'semibold', tokens.colors.textPrimary),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Right Label',
        x: w / 2,
        y: 0,
        width: w / 2,
        height: 20,
        text: rightLabel,
        style: makeStyle({ fill: '#00000000', fontSize: tokens.typography.caption.fontSize, fontWeight: 'semibold', textColor: tokens.colors.textSecondary, textAlign: 'right' }),
      }),
      makeDesignNode({
        type: 'Rectangle',
        name: 'Track',
        x: 0,
        y: 24,
        width: w,
        height: barHeight,
        style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: barHeight / 2 }),
      }),
      makeDesignNode({
        type: 'Rectangle',
        name: 'Fill',
        x: 0,
        y: 24,
        width: barWidth,
        height: barHeight,
        style: makeStyle({
          fill: '#00000000',
          cornerRadius: barHeight / 2,
          gradient: tokens.gradients?.accent ?? { type: 'linear', colors: [tokens.colors.accentPrimary, tokens.colors.textPrimary], angle: 90, stops: [0, 1] },
        }),
      }),
    ],
  });
}

function createCategoryRow(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 342;
  const h = action.height ?? 72;
  const title = prop(props, 'title') ?? 'Groceries';
  const subtitle = prop(props, 'subtitle') ?? '42 Transactions';
  const amount = prop(props, 'amount') ?? '-$450.00';
  const iconName = prop(props, 'icon') ?? 'cart.fill';

  return makeDesignNode({
    type: 'Frame',
    name: action.nodeReference ?? 'categoryRow',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.md }),
    children: [
      makeDesignNode({
        type: 'Frame',
        name: 'Icon BG',
        x: 16,
        y: 12,
        width: 48,
        height: 48,
        style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: tokens.radius.md }),
        children: [
          makeDesignNode({
            type: 'Icon',
            name: 'Icon',
            x: 12,
            y: 12,
            width: 24,
            height: 24,
            iconName,
            style: makeStyle({ fill: '#00000000', fontSize: 20, textColor: tokens.colors.textPrimary }),
          }),
        ],
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Title',
        x: 76,
        y: 16,
        width: w - 160,
        height: 20,
        text: title,
        style: transparentTextStyle(tokens.typography.body.fontSize, 'semibold', tokens.colors.textPrimary),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Subtitle',
        x: 76,
        y: 40,
        width: w - 160,
        height: 16,
        text: subtitle,
        style: transparentTextStyle(tokens.typography.caption.fontSize, undefined, tokens.colors.textSecondary),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Amount',
        x: w - 120,
        y: h / 2 - 10,
        width: 104,
        height: 20,
        text: amount,
        style: makeStyle({ fill: '#00000000', fontSize: tokens.typography.body.fontSize, fontWeight: 'semibold', textColor: tokens.colors.textPrimary, textAlign: 'right' }),
      }),
    ],
  });
}

function createBudgetGauge(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 342;
  const h = action.height ?? 200;
  const title = prop(props, 'title') ?? 'Left to Spend';
  const amount = prop(props, 'amount') ?? '$1,250';
  const subtitle = prop(props, 'subtitle') ?? 'of $3,000 budget';

  const ringSize = Math.min(w - 32, h - 32);

  return makeDesignNode({
    type: 'Frame',
    name: action.nodeReference ?? 'budgetGauge',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.lg, shadow: { color: '#000000', opacity: 0.05, radius: 10, x: 0, y: 4 } }),
    children: [
      // Background arc (approximate with a rounded rect for now since we don't have true arcs)
      makeDesignNode({
        type: 'Rectangle',
        name: 'Gauge Track',
        x: (w - ringSize) / 2,
        y: (h - ringSize) / 2,
        width: ringSize,
        height: ringSize,
        style: makeStyle({ fill: '#00000000', stroke: tokens.colors.surfaceSecondary, strokeWidth: 16, cornerRadius: ringSize / 2 }),
      }),
      // Text centered inside
      makeDesignNode({
        type: 'Text',
        name: 'Title',
        x: 0,
        y: h / 2 - 36,
        width: w,
        height: 20,
        text: title,
        style: makeStyle({ fill: '#00000000', fontSize: tokens.typography.caption.fontSize, textColor: tokens.colors.textSecondary, textAlign: 'center' }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Amount',
        x: 0,
        y: h / 2 - 12,
        width: w,
        height: 36,
        text: amount,
        style: makeStyle({ fill: '#00000000', fontSize: tokens.typography.headline.fontSize + 4, fontWeight: 'bold', textColor: tokens.colors.textPrimary, textAlign: 'center' }),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Subtitle',
        x: 0,
        y: h / 2 + 28,
        width: w,
        height: 20,
        text: subtitle,
        style: makeStyle({ fill: '#00000000', fontSize: tokens.typography.caption.fontSize, textColor: tokens.colors.textSecondary, textAlign: 'center' }),
      }),
    ],
  });
}

function createControlButton(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 80;
  const h = action.height ?? 100;
  const label = prop(props, 'label') ?? 'Lock';
  const iconName = prop(props, 'icon') ?? 'lock.fill';

  const isActive = (prop(props, 'isActive') ?? 'false').toLowerCase() === 'true';
  const iconBg = isActive ? tokens.colors.accentPrimary : tokens.colors.surfacePrimary;
  const iconColor = isActive ? tokens.colors.backgroundPrimary : tokens.colors.textPrimary;

  return makeDesignNode({
    type: 'Frame',
    name: action.nodeReference ?? 'controlButton',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: '#00000000' }),
    children: [
      makeDesignNode({
        type: 'Frame',
        name: 'Button BG',
        x: (w - 60) / 2,
        y: 0,
        width: 60,
        height: 60,
        style: makeStyle({ fill: iconBg, cornerRadius: 30, shadow: { color: '#000000', opacity: 0.05, radius: 8, x: 0, y: 4 } }),
        children: [
          makeDesignNode({
            type: 'Icon',
            name: 'Icon',
            x: 18,
            y: 18,
            width: 24,
            height: 24,
            iconName,
            style: makeStyle({ fill: '#00000000', fontSize: 20, textColor: iconColor }),
          }),
        ],
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Label',
        x: 0,
        y: 72,
        width: w,
        height: 20,
        text: label,
        style: makeStyle({ fill: '#00000000', fontSize: tokens.typography.caption.fontSize, fontWeight: 'semibold', textColor: tokens.colors.textPrimary, textAlign: 'center' }),
      }),
    ],
  });
}

function createInsightCard(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 342;
  const h = action.height ?? 140;
  const title = prop(props, 'title') ?? 'Spending Alert';
  const description = prop(props, 'description') ?? "You've spent 20% more on dining this month.";
  const iconName = prop(props, 'icon') ?? 'exclamationmark.triangle.fill';
  const isPositive = (prop(props, 'isPositive') ?? 'false').toLowerCase() === 'true';

  const accentColor = isPositive ? (tokens.colors.success ?? '#34D399') : (tokens.colors.warning ?? '#FBBF24');

  return makeDesignNode({
    type: 'Frame',
    name: action.nodeReference ?? 'insightCard',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.lg, shadow: { color: '#000000', opacity: 0.08, radius: 12, x: 0, y: 6 } }),
    children: [
      makeDesignNode({
        type: 'Frame',
        name: 'Icon Container',
        x: 20,
        y: 20,
        width: 40,
        height: 40,
        style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: 20 }),
        children: [
          makeDesignNode({
            type: 'Icon',
            name: 'Icon',
            x: 10,
            y: 10,
            width: 20,
            height: 20,
            iconName,
            style: makeStyle({ fill: '#00000000', fontSize: 16, textColor: accentColor }),
          }),
        ],
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Title',
        x: 76,
        y: 20,
        width: w - 96,
        height: 24,
        text: title,
        style: transparentTextStyle(tokens.typography.body.fontSize, 'bold', tokens.colors.textPrimary),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Description',
        x: 76,
        y: 48,
        width: w - 96,
        height: h - 64,
        text: description,
        style: transparentTextStyle(tokens.typography.caption.fontSize + 1, undefined, tokens.colors.textSecondary),
      }),
    ],
  });
}

function createSecuritySettingRow(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 342;
  const h = action.height ?? 88;
  const title = prop(props, 'title') ?? 'Freeze Card';
  const subtitle = prop(props, 'subtitle') ?? 'Temporarily disable transactions';
  const isOn = (prop(props, 'isOn') ?? 'false').toLowerCase() === 'true';

  const toggleColor = isOn ? (tokens.colors.success ?? '#34D399') : tokens.colors.surfaceSecondary;
  const knobX = isOn ? 26 : 2;

  return makeDesignNode({
    type: 'Frame',
    name: action.nodeReference ?? 'securitySettingRow',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.md }),
    children: [
      makeDesignNode({
        type: 'Text',
        name: 'Title',
        x: 16,
        y: 20,
        width: w - 90,
        height: 24,
        text: title,
        style: transparentTextStyle(tokens.typography.body.fontSize, 'semibold', tokens.colors.textPrimary),
      }),
      makeDesignNode({
        type: 'Text',
        name: 'Subtitle',
        x: 16,
        y: 46,
        width: w - 90,
        height: 36,
        text: subtitle,
        style: transparentTextStyle(tokens.typography.caption.fontSize, undefined, tokens.colors.textSecondary),
      }),
      makeDesignNode({
        type: 'Frame',
        name: 'Toggle Track',
        x: w - 66,
        y: h / 2 - 16,
        width: 50,
        height: 32,
        style: makeStyle({ fill: toggleColor, cornerRadius: 16 }),
        children: [
          makeDesignNode({
            type: 'Rectangle',
            name: 'Toggle Knob',
            x: knobX,
            y: 2,
            width: 28,
            height: 28,
            style: makeStyle({ fill: '#FFFFFF', cornerRadius: 14, shadow: { color: '#000000', opacity: 0.1, radius: 4, x: 0, y: 2 } }),
          }),
        ],
      }),
    ],
  });
}

function createSidebar(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 280;
  const h = action.height ?? 800;

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Sidebar',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: 0, opacity: 1.0 }),
    children: [
      makeDesignNode({ type: 'Text', name: 'App Title', x: 24, y: 32, width: w - 48, height: 32, text: prop(props, 'title') ?? 'My App', style: transparentTextStyle(24, 'bold', tokens.colors.textPrimary) }),
      makeDesignNode({ type: 'Icon', name: 'Nav Icon 1', x: 24, y: 92, width: 24, height: 24, iconName: 'square.grid.2x2.fill', style: makeStyle({ fill: '#00000000', textColor: tokens.colors.accentPrimary }) }),
      makeDesignNode({ type: 'Text', name: 'Nav Label 1', x: 60, y: 92, width: w - 84, height: 24, text: 'Dashboard', style: transparentTextStyle(17, 'semibold', tokens.colors.accentPrimary) }),
      makeDesignNode({ type: 'Icon', name: 'Nav Icon 2', x: 24, y: 140, width: 24, height: 24, iconName: 'book.fill', style: makeStyle({ fill: '#00000000', textColor: tokens.colors.textSecondary }) }),
      makeDesignNode({ type: 'Text', name: 'Nav Label 2', x: 60, y: 140, width: w - 84, height: 24, text: 'Library', style: transparentTextStyle(17, undefined, tokens.colors.textSecondary) }),
      makeDesignNode({ type: 'Icon', name: 'Nav Icon 3', x: 24, y: 188, width: 24, height: 24, iconName: 'star.fill', style: makeStyle({ fill: '#00000000', textColor: tokens.colors.textSecondary }) }),
      makeDesignNode({ type: 'Text', name: 'Nav Label 3', x: 60, y: 188, width: w - 84, height: 24, text: 'Favorites', style: transparentTextStyle(17, undefined, tokens.colors.textSecondary) }),
    ],
  });
}

function createSplitView(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 1024;
  const h = action.height ?? 768;
  const sidebarW = 300;

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Split View',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h,
    style: makeStyle({ fill: tokens.colors.backgroundPrimary, cornerRadius: 0, opacity: 1.0 }),
    children: [
      createSidebar(undefined, makeDesignAction({ type: 'createComponent', x: 0, y: 0, width: sidebarW, height: h }), tokens),
      makeDesignNode({ type: 'Frame', name: 'Main Content Area', x: sidebarW, y: 0, width: w - sidebarW, height: h, style: makeStyle({ fill: tokens.colors.backgroundPrimary, cornerRadius: 0, opacity: 1.0 }), children: [] }),
    ],
  });
}

function createCardGrid(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 700;
  const h = action.height ?? 600;
  const cols = 3;
  const spacing = 24;
  const cardW = (w - (cols - 1) * spacing) / cols;
  const cardH = cardW * 1.4;

  const children: DesignNode[] = [];
  for (let i = 0; i < 6; i += 1) {
    const row = Math.trunc(i / cols);
    const col = i % cols;

    children.push(
      createMediaCard(
        { title: `Item ${i + 1}`, subtitle: 'Description' },
        makeDesignAction({ type: 'createComponent', x: col * (cardW + spacing), y: row * (cardH + spacing + 40), width: cardW, height: cardH }),
        tokens,
      ),
    );
  }

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Card Grid',
    x: action.x ?? 16,
    y: action.y ?? 16,
    width: w,
    height: h,
    style: makeStyle({ fill: '#00000000' }),
    children,
  });
}

function createMediaCard(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 180;
  const h = action.height ?? 260;
  const title = prop(props, 'title') ?? prop(props, 'name') ?? 'Featured';
  const subtitle = prop(props, 'subtitle') ?? prop(props, 'author') ?? prop(props, 'price') ?? 'Tap to view';
  const image = prop(props, 'image') ?? 'book_cover_placeholder';

  return makeDesignNode({
    type: 'Frame',
    name: action.name ?? 'Media Card',
    x: action.x ?? 0,
    y: action.y ?? 0,
    width: w,
    height: h + 60, // Extra space for text below the cover
    style: makeStyle({ fill: '#00000000' }),
    children: [
      makeDesignNode({
        type: 'Image',
        name: 'Cover Image',
        x: 0,
        y: 0,
        width: w,
        height: h,
        imageName: image,
        imageSource: image,
        contentMode: 'fill',
        style: makeStyle({
          fill: tokens.colors.surfaceSecondary,
          cornerRadius: tokens.radius.md,
          opacity: 1.0,
          shadow: { color: '#000000', opacity: 0.15, radius: 12, x: 0, y: 6 },
        }),
      }),
      makeDesignNode({ type: 'Text', name: 'Title', x: 0, y: h + 16, width: w, height: 24, text: title, style: transparentTextStyle(16, 'semibold', tokens.colors.textPrimary) }),
      makeDesignNode({ type: 'Text', name: 'Subtitle', x: 0, y: h + 42, width: w, height: 20, text: subtitle, style: transparentTextStyle(14, undefined, tokens.colors.textSecondary) }),
    ],
  });
}

function createInputField(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = 56;
  const placeholder = prop(props, 'placeholder') ?? prop(props, 'label') ?? 'Enter text';

  // A REAL .Input node, not a decorative Frame with a placeholder label.
  // The decorative version could never be typed into — so every composed
  // form, search bar and auth screen built from this component was a
  // picture of a form. The exporter renders .Input as a TextField (or
  // SecureField for password-named fields) and the wiring passes can
  // bind its value to a variable.
  const node = makeDesignNode({
    type: 'Input', name: action.name ?? 'Input Field',
    x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
    text: placeholder,
    style: makeStyle({
      fill: tokens.colors.surfaceSecondary, cornerRadius: 12,
      fontSize: 15, textColor: tokens.colors.textPrimary,
    }),
  });
  node.style.paddingLeft = 16;
  const sensitive = (action.name ?? '') + ' ' + placeholder;
  if (sensitive.toLowerCase().includes('password') || sensitive.includes('סיסמ')) {
    node.isSecure = true;
  }
  return node;
}

function createTextLink(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 100;
  const h = 20;
  const text = prop(props, 'text') ?? prop(props, 'label') ?? 'Learn more';
  return makeDesignNode({
    type: 'Text', name: action.name ?? 'Text Link',
    x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
    text,
    style: transparentTextStyle(14, 'semibold', tokens.colors.accentPrimary),
  });
}

function createTextHeadline(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = action.height ?? (type === 'editorialHeadline' ? 80 : 120);
  const text = prop(props, 'text') ?? prop(props, 'content') ?? 'Sample text content.';
  const fontSize = type === 'editorialHeadline' ? 28 : 16;
  const weight = type === 'editorialHeadline' ? 'bold' : 'regular';

  return makeDesignNode({
    type: 'Text', name: action.name ?? type,
    x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
    text,
    style: transparentTextStyle(fontSize, weight, tokens.colors.textPrimary),
  });
}

function createIllustrationBlock(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = action.height ?? 200;
  const iconName = prop(props, 'icon') ?? 'sparkles';

  return makeDesignNode({
    type: 'Frame', name: action.name ?? type,
    x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
    style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: 16 }),
    children: [
      makeDesignNode({ type: 'Icon', name: 'Illustration', x: (w - 64) / 2, y: (h - 64) / 2, width: 64, height: 64, iconName, style: makeStyle({ fill: '#00000000', textColor: tokens.colors.accentPrimary }) }),
    ],
  });
}

function createProgressCard(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = action.height ?? 100;
  const title = prop(props, 'title') ?? 'Progress';
  const subtitle = prop(props, 'subtitle') ?? '50%';

  return makeDesignNode({
    type: 'Frame', name: action.name ?? 'Progress Card',
    x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
    style: makeStyle({ fill: tokens.colors.surfacePrimary, cornerRadius: 16, shadow: { color: '#000000', opacity: 0.05, radius: 10, x: 0, y: 4 } }),
    children: [
      makeDesignNode({ type: 'Text', name: 'Title', x: 16, y: 16, width: w - 32, height: 20, text: title, style: transparentTextStyle(16, 'bold', tokens.colors.textPrimary) }),
      makeDesignNode({ type: 'Text', name: 'Subtitle', x: 16, y: 38, width: w - 32, height: 16, text: subtitle, style: transparentTextStyle(14, undefined, tokens.colors.textSecondary) }),
      makeDesignNode({ type: 'Rectangle', name: 'Track', x: 16, y: 64, width: w - 32, height: 8, style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: 4 }) }),
      makeDesignNode({ type: 'Rectangle', name: 'Fill', x: 16, y: 64, width: (w - 32) * 0.5, height: 8, style: makeStyle({ fill: tokens.colors.accentPrimary, cornerRadius: 4 }) }),
    ],
  });
}

function createDestinationCard(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? (type === 'destinationHeroCard' ? 358 : 200);
  const h = action.height ?? (type === 'destinationHeroCard' ? 400 : 250);
  const title = prop(props, 'title') ?? prop(props, 'destination') ?? 'Paris';
  const subtitle = prop(props, 'subtitle') ?? prop(props, 'country') ?? 'France';
  const image = prop(props, 'image') ?? 'travel_mountain';

  return makeDesignNode({
    type: 'Frame', name: action.name ?? 'Destination Card',
    x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
    style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: 24, shadow: { color: '#000000', opacity: 0.1, radius: 12, x: 0, y: 6 } }),
    children: [
      makeDesignNode({ type: 'Image', name: 'Cover', x: 0, y: 0, width: w, height: h, imageName: image, style: makeStyle({ fill: '#00000000', cornerRadius: 24 }) }),
      makeDesignNode({ type: 'Rectangle', name: 'Gradient', x: 0, y: h / 2, width: w, height: h / 2, style: makeStyle({ fill: '#000000', cornerRadius: 24, opacity: 0.5 }) }),
      makeDesignNode({ type: 'Text', name: 'Title', x: 20, y: h - 60, width: w - 40, height: 28, text: title, style: transparentTextStyle(24, 'bold', '#FFFFFF') }),
      makeDesignNode({ type: 'Text', name: 'Subtitle', x: 20, y: h - 30, width: w - 40, height: 16, text: subtitle, style: transparentTextStyle(14, undefined, '#E5E7EB') }),
    ],
  });
}

function createMoodJournalCard(type: ComponentType, props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = action.height ?? 160;
  const title = prop(props, 'title') ?? prop(props, 'prompt') ?? 'How are you feeling?';
  const iconName = prop(props, 'icon') ?? (type === 'moodCheckInCard' ? 'face.smiling' : 'book.closed');

  return makeDesignNode({
    type: 'Frame', name: action.name ?? type,
    x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
    style: makeStyle({ fill: tokens.colors.surfacePrimary, cornerRadius: 20, shadow: { color: '#000000', opacity: 0.08, radius: 16, x: 0, y: 8 } }),
    children: [
      makeDesignNode({ type: 'Icon', name: 'Icon', x: 20, y: 20, width: 32, height: 32, iconName, style: makeStyle({ fill: '#00000000', textColor: tokens.colors.accentPrimary }) }),
      makeDesignNode({ type: 'Text', name: 'Title', x: 20, y: 64, width: w - 40, height: 60, text: title, style: transparentTextStyle(18, 'semibold', tokens.colors.textPrimary) }),
      makeDesignNode({ type: 'Button', name: 'Action', x: w - 50, y: 20, width: 30, height: 30, text: '', iconName: 'arrow.right', style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: 15, textColor: tokens.colors.textPrimary }), children: [] }),
    ],
  });
}

function createAmenityRow(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 358;
  const h = 40;
  const title = prop(props, 'title') ?? prop(props, 'amenity') ?? 'Free Wi-Fi';
  const iconName = prop(props, 'icon') ?? 'wifi';

  return makeDesignNode({
    type: 'Frame', name: action.name ?? 'Amenity',
    x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
    style: makeStyle({ fill: '#00000000' }),
    children: [
      makeDesignNode({ type: 'Icon', name: 'Icon', x: 0, y: 8, width: 24, height: 24, iconName, style: makeStyle({ fill: '#00000000', textColor: tokens.colors.textSecondary }) }),
      makeDesignNode({ type: 'Text', name: 'Title', x: 40, y: 10, width: w - 40, height: 20, text: title, style: transparentTextStyle(15, undefined, tokens.colors.textPrimary) }),
    ],
  });
}

function createInstructorCard(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 160;
  const h = action.height ?? 200;
  const name = prop(props, 'name') ?? 'Instructor';
  const role = prop(props, 'role') ?? 'Guide';
  const image = prop(props, 'image') ?? 'profile_placeholder';

  return makeDesignNode({
    type: 'Frame', name: action.name ?? 'Instructor Card',
    x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
    style: makeStyle({ fill: tokens.colors.surfacePrimary, cornerRadius: 16 }),
    children: [
      makeDesignNode({ type: 'Image', name: 'Avatar', x: (w - 80) / 2, y: 24, width: 80, height: 80, imageName: image, style: makeStyle({ fill: '#00000000', cornerRadius: 40 }) }),
      makeDesignNode({ type: 'Text', name: 'Name', x: 10, y: 120, width: w - 20, height: 20, text: name, style: transparentTextStyle(16, 'bold', tokens.colors.textPrimary, 'center') }),
      makeDesignNode({ type: 'Text', name: 'Role', x: 10, y: 144, width: w - 20, height: 16, text: role, style: transparentTextStyle(13, undefined, tokens.colors.textSecondary, 'center') }),
    ],
  });
}

function createProductDetailPanel(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 390;
  const h = action.height ?? 400;
  const title = prop(props, 'title') ?? 'Product Name';
  const price = prop(props, 'price') ?? '$99.99';
  const desc = prop(props, 'description') ?? 'Product description goes here.';

  return makeDesignNode({
    type: 'Frame', name: action.name ?? 'Product Details',
    x: action.x ?? 0, y: action.y ?? 400, width: w, height: h,
    style: makeStyle({ fill: tokens.colors.backgroundPrimary, cornerRadius: 32, shadow: { color: '#000000', opacity: 0.1, radius: 20, x: 0, y: -4 } }),
    children: [
      makeDesignNode({ type: 'Rectangle', name: 'Handle', x: w / 2 - 20, y: 12, width: 40, height: 4, style: makeStyle({ fill: tokens.colors.surfaceSecondary, cornerRadius: 2 }) }),
      makeDesignNode({ type: 'Text', name: 'Title', x: 24, y: 40, width: w - 120, height: 32, text: title, style: transparentTextStyle(24, 'bold', tokens.colors.textPrimary) }),
      makeDesignNode({ type: 'Text', name: 'Price', x: w - 90, y: 44, width: 66, height: 28, text: price, style: transparentTextStyle(20, 'bold', tokens.colors.accentPrimary, 'right') }),
      makeDesignNode({ type: 'Text', name: 'Description', x: 24, y: 80, width: w - 48, height: 100, text: desc, style: transparentTextStyle(15, undefined, tokens.colors.textSecondary) }),
    ],
  });
}

function createOnboardingScreen(props: Props, action: DesignAction, tokens: DesignTokens): DesignNode {
  const w = action.width ?? 390;
  const h = action.height ?? 844;
  const title = prop(props, 'title') ?? 'Welcome';
  const subtitle = prop(props, 'subtitle') ?? "Let's get started";
  const image = prop(props, 'image') ?? 'travel_forest';

  return makeDesignNode({
    type: 'Frame', name: action.name ?? 'Onboarding Screen',
    x: action.x ?? 0, y: action.y ?? 0, width: w, height: h,
    style: makeStyle({ fill: tokens.colors.backgroundPrimary }),
    children: [
      makeDesignNode({ type: 'Image', name: 'Image', x: 0, y: 0, width: w, height: h * 0.6, imageName: image, style: makeStyle({ fill: tokens.colors.surfaceSecondary }) }),
      makeDesignNode({ type: 'Text', name: 'Title', x: 24, y: h * 0.6 + 40, width: w - 48, height: 40, text: title, style: transparentTextStyle(32, 'bold', tokens.colors.textPrimary) }),
      makeDesignNode({ type: 'Text', name: 'Subtitle', x: 24, y: h * 0.6 + 90, width: w - 48, height: 60, text: subtitle, style: transparentTextStyle(16, undefined, tokens.colors.textSecondary) }),
    ],
  });
}
