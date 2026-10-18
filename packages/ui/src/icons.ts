/// <reference path="./assets.d.ts" />
/** Íconos Lucide de ./icons (ISC). Se insertan en línea para heredar currentColor. */
import aLargeSmall from './icons/a-large-small.svg?raw';
import arrowLeft from './icons/arrow-left.svg?raw';
import arrowRight from './icons/arrow-right.svg?raw';
import calendarCheck from './icons/calendar-check.svg?raw';
import check from './icons/check.svg?raw';
import chevronRight from './icons/chevron-right.svg?raw';
import chevronUp from './icons/chevron-up.svg?raw';
import circleCheck from './icons/circle-check.svg?raw';
import circleHelp from './icons/circle-help.svg?raw';
import circleSlash from './icons/circle-slash.svg?raw';
import clock from './icons/clock.svg?raw';
import externalLink from './icons/external-link.svg?raw';
import fileText from './icons/file-text.svg?raw';
import house from './icons/house.svg?raw';
import lock from './icons/lock.svg?raw';
import logOut from './icons/log-out.svg?raw';
import mapPin from './icons/map-pin.svg?raw';
import maximize2 from './icons/maximize-2.svg?raw';
import mic from './icons/mic.svg?raw';
import minus from './icons/minus.svg?raw';
import navigation from './icons/navigation.svg?raw';
import refreshCw from './icons/refresh-cw.svg?raw';
import rotateCcw from './icons/rotate-ccw.svg?raw';
import rotateCw from './icons/rotate-cw.svg?raw';
import search from './icons/search.svg?raw';
import send from './icons/send.svg?raw';
import square from './icons/square.svg?raw';
import shieldAlert from './icons/shield-alert.svg?raw';
import shieldCheck from './icons/shield-check.svg?raw';
import sparkles from './icons/sparkles.svg?raw';
import triangleAlert from './icons/triangle-alert.svg?raw';
import volume2 from './icons/volume-2.svg?raw';
import x from './icons/x.svg?raw';

export const ICONS = {
  'a-large-small': aLargeSmall,
  'arrow-left': arrowLeft,
  'arrow-right': arrowRight,
  'calendar-check': calendarCheck,
  'check': check,
  'chevron-right': chevronRight,
  'chevron-up': chevronUp,
  'circle-check': circleCheck,
  'circle-help': circleHelp,
  'circle-slash': circleSlash,
  'clock': clock,
  'external-link': externalLink,
  'file-text': fileText,
  'house': house,
  'lock': lock,
  'log-out': logOut,
  'map-pin': mapPin,
  'maximize-2': maximize2,
  'mic': mic,
  'minus': minus,
  'navigation': navigation,
  'refresh-cw': refreshCw,
  'rotate-ccw': rotateCcw,
  'rotate-cw': rotateCw,
  'search': search,
  'send': send,
  'shield-alert': shieldAlert,
  'shield-check': shieldCheck,
  'sparkles': sparkles,
  'square': square,
  'triangle-alert': triangleAlert,
  'volume-2': volume2,
  'x': x,
} as const;

export type IconName = keyof typeof ICONS;
