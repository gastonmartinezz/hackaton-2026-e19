/// <reference path="./assets.d.ts" />
/** Íconos Lucide de design/icons (ISC). Se insertan en línea para heredar currentColor. */
import aLargeSmall from '../../../design/icons/a-large-small.svg?raw';
import arrowLeft from '../../../design/icons/arrow-left.svg?raw';
import arrowRight from '../../../design/icons/arrow-right.svg?raw';
import calendarCheck from '../../../design/icons/calendar-check.svg?raw';
import check from '../../../design/icons/check.svg?raw';
import chevronRight from '../../../design/icons/chevron-right.svg?raw';
import chevronUp from '../../../design/icons/chevron-up.svg?raw';
import circleCheck from '../../../design/icons/circle-check.svg?raw';
import circleHelp from '../../../design/icons/circle-help.svg?raw';
import circleSlash from '../../../design/icons/circle-slash.svg?raw';
import clock from '../../../design/icons/clock.svg?raw';
import externalLink from '../../../design/icons/external-link.svg?raw';
import fileText from '../../../design/icons/file-text.svg?raw';
import house from '../../../design/icons/house.svg?raw';
import lock from '../../../design/icons/lock.svg?raw';
import logOut from '../../../design/icons/log-out.svg?raw';
import mapPin from '../../../design/icons/map-pin.svg?raw';
import maximize2 from '../../../design/icons/maximize-2.svg?raw';
import mic from '../../../design/icons/mic.svg?raw';
import minus from '../../../design/icons/minus.svg?raw';
import refreshCw from '../../../design/icons/refresh-cw.svg?raw';
import rotateCcw from '../../../design/icons/rotate-ccw.svg?raw';
import rotateCw from '../../../design/icons/rotate-cw.svg?raw';
import search from '../../../design/icons/search.svg?raw';
import send from '../../../design/icons/send.svg?raw';
import shieldAlert from '../../../design/icons/shield-alert.svg?raw';
import shieldCheck from '../../../design/icons/shield-check.svg?raw';
import sparkles from '../../../design/icons/sparkles.svg?raw';
import triangleAlert from '../../../design/icons/triangle-alert.svg?raw';
import x from '../../../design/icons/x.svg?raw';

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
  'refresh-cw': refreshCw,
  'rotate-ccw': rotateCcw,
  'rotate-cw': rotateCw,
  'search': search,
  'send': send,
  'shield-alert': shieldAlert,
  'shield-check': shieldCheck,
  'sparkles': sparkles,
  'triangle-alert': triangleAlert,
  'x': x,
} as const;

export type IconName = keyof typeof ICONS;
