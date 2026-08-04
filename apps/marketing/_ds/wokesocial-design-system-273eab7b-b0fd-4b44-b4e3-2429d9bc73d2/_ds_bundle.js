/* @ds-bundle: {"format":4,"namespace":"WetDroolDesignSystem_273eab","components":[{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"Fab","sourcePath":"components/actions/Fab.jsx"},{"name":"IconButton","sourcePath":"components/actions/IconButton.jsx"},{"name":"BrandMark","sourcePath":"components/brand/BrandMark.jsx"},{"name":"Eyebrow","sourcePath":"components/brand/Eyebrow.jsx"},{"name":"Avatar","sourcePath":"components/display/Avatar.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"Chip","sourcePath":"components/display/Chip.jsx"},{"name":"SectionHeading","sourcePath":"components/display/SectionHeading.jsx"},{"name":"Skeleton","sourcePath":"components/display/Skeleton.jsx"},{"name":"StatusBadge","sourcePath":"components/display/StatusBadge.jsx"},{"name":"Banner","sourcePath":"components/feedback/Banner.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"ProgressBar","sourcePath":"components/feedback/ProgressBar.jsx"},{"name":"StatePanel","sourcePath":"components/feedback/StatePanel.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Field","sourcePath":"components/forms/Field.jsx"},{"name":"SearchField","sourcePath":"components/forms/SearchField.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Icon","sourcePath":"components/icon/Icon.jsx"},{"name":"MobileDock","sourcePath":"components/navigation/MobileDock.jsx"},{"name":"NavRail","sourcePath":"components/navigation/NavRail.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"ThemePicker","sourcePath":"components/navigation/ThemePicker.jsx"},{"name":"CommunityCard","sourcePath":"components/social/CommunityCard.jsx"},{"name":"ComposerBar","sourcePath":"components/social/ComposerBar.jsx"},{"name":"EventCard","sourcePath":"components/social/EventCard.jsx"},{"name":"NotificationRow","sourcePath":"components/social/NotificationRow.jsx"},{"name":"PostCard","sourcePath":"components/social/PostCard.jsx"},{"name":"ReactionBar","sourcePath":"components/social/ReactionBar.jsx"},{"name":"ProviderHealthNotice","sourcePath":"components/trust/ProviderHealthNotice.jsx"},{"name":"TransactionStatus","sourcePath":"components/trust/TransactionStatus.jsx"},{"name":"VerificationDetail","sourcePath":"components/trust/VerificationDetail.jsx"},{"name":"WalletConnectCard","sourcePath":"components/trust/WalletConnectCard.jsx"}],"sourceHashes":{"components/actions/Button.jsx":"8a6a9e001d59","components/actions/Fab.jsx":"2880c81aa22f","components/actions/IconButton.jsx":"d56ebed223d6","components/brand/BrandMark.jsx":"a34940e58124","components/brand/Eyebrow.jsx":"bae0b604a2d9","components/display/Avatar.jsx":"2377f38e87fc","components/display/Card.jsx":"f48a11185486","components/display/Chip.jsx":"39e287835944","components/display/SectionHeading.jsx":"36599399efdf","components/display/Skeleton.jsx":"0e901c618c32","components/display/StatusBadge.jsx":"c19e3e786a95","components/feedback/Banner.jsx":"48382524bb41","components/feedback/Dialog.jsx":"becf3e5eb9e1","components/feedback/ProgressBar.jsx":"3f66f8c6e609","components/feedback/StatePanel.jsx":"aa9de93ee2db","components/feedback/Toast.jsx":"78c242fe8708","components/forms/Checkbox.jsx":"6f43aed55dec","components/forms/Field.jsx":"c0b8b42cba5a","components/forms/SearchField.jsx":"ddfd4f0d63bc","components/forms/Select.jsx":"2cf45f76b3d5","components/forms/Switch.jsx":"adfa55536a6f","components/icon/Icon.jsx":"b4cf1b45124f","components/navigation/MobileDock.jsx":"51ff7b13162b","components/navigation/NavRail.jsx":"bfb9be68ad41","components/navigation/Tabs.jsx":"162f841f4ea0","components/navigation/ThemePicker.jsx":"41bbb359569b","components/social/CommunityCard.jsx":"8e4d246c4aac","components/social/ComposerBar.jsx":"9067fc8877b0","components/social/EventCard.jsx":"19890697467c","components/social/NotificationRow.jsx":"228f0ff902b2","components/social/PostCard.jsx":"c8207ea10287","components/social/ReactionBar.jsx":"7e653714c541","components/trust/ProviderHealthNotice.jsx":"11850dcbcb68","components/trust/TransactionStatus.jsx":"ff5282552b91","components/trust/VerificationDetail.jsx":"279d8a834b5e","components/trust/WalletConnectCard.jsx":"17fd3eb51f85","ui_kits/marketing/Landing.jsx":"0a3e92a96076","ui_kits/prototype/PAI.jsx":"75ff1725ae82","ui_kits/prototype/PApp.jsx":"42bf14ca14b9","ui_kits/prototype/PFeed.jsx":"d60cfa8c69c9","ui_kits/prototype/PPlus.jsx":"44da4ac0f6bb","ui_kits/prototype/PShell.jsx":"aeb2808d29c6","ui_kits/prototype/PStudio.jsx":"337c8ac2c1fe","ui_kits/prototype/PVideo.jsx":"9871e6de63df","ui_kits/prototype/PWallet.jsx":"478b8418e38a","ui_kits/prototype/pdata.js":"2bc58baa94d1","ui_kits/seeker/Screens.jsx":"df3002788b1c","ui_kits/seeker/android-frame.jsx":"cbf1bf9e56aa","ui_kits/web-app/App.jsx":"c4b88c795eaf","ui_kits/web-app/Explore.jsx":"4101a4763d83","ui_kits/web-app/HomeFeed.jsx":"5118931ddddf","ui_kits/web-app/PostDetail.jsx":"79ad523e75c0","ui_kits/web-app/Profile.jsx":"4843cee1451f","ui_kits/web-app/Safety.jsx":"896894ebda61","ui_kits/web-app/Settings.jsx":"6f26aeb5ad2c","ui_kits/web-app/Shell.jsx":"89eb39507743","ui_kits/web-app/data.js":"5242583d1a04"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.WetDroolDesignSystem_273eab = window.WetDroolDesignSystem_273eab || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/Button.jsx
try { (() => {
function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  disabled = false,
  href,
  leadingIcon,
  trailingIcon,
  children,
  className = '',
  ...rest
}) {
  const Tag = href ? 'a' : 'button';
  const cls = ['ws-btn', `ws-btn--${variant}`, size !== 'md' ? `ws-btn--${size}` : '', block ? 'ws-btn--block' : '', className].filter(Boolean).join(' ');
  const props = {
    className: cls,
    href,
    'data-loading': loading || undefined,
    'aria-busy': loading || undefined,
    ...rest
  };
  if (Tag === 'button') {
    props.type = rest.type || 'button';
    props.disabled = disabled || loading;
  } else if (disabled || loading) {
    props['aria-disabled'] = 'true';
    props.tabIndex = -1;
  }
  return React.createElement(Tag, props, loading ? React.createElement('span', {
    className: 'ws-btn__spinner',
    'aria-hidden': 'true'
  }) : leadingIcon, children, trailingIcon);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button.jsx", error: String((e && e.message) || e) }); }

// components/actions/Fab.jsx
try { (() => {
function Fab({
  label,
  extended = true,
  variant = 'primary',
  children,
  className = '',
  ...rest
}) {
  return React.createElement('button', {
    type: 'button',
    className: ['ws-fab', extended ? '' : 'ws-fab--icon', variant === 'signal' ? 'ws-fab--signal' : '', className].filter(Boolean).join(' '),
    'aria-label': extended ? undefined : label,
    ...rest
  }, children, extended ? React.createElement('span', null, label) : null);
}
Object.assign(__ds_scope, { Fab });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Fab.jsx", error: String((e && e.message) || e) }); }

// components/actions/IconButton.jsx
try { (() => {
function IconButton({
  label,
  variant = 'ghost',
  tone,
  inline = false,
  pressed,
  disabled = false,
  children,
  className = '',
  ...rest
}) {
  return React.createElement('button', {
    type: 'button',
    className: ['ws-iconbtn', variant !== 'ghost' ? `ws-iconbtn--${variant}` : '', tone === 'danger' ? 'ws-iconbtn--danger' : '', inline ? 'ws-iconbtn--inline' : '', className].filter(Boolean).join(' '),
    'aria-label': label,
    'aria-pressed': typeof pressed === 'boolean' ? String(pressed) : undefined,
    disabled,
    ...rest
  }, children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/brand/BrandMark.jsx
try { (() => {
/* Renders the real $DROOL artwork from assets/logo. Never redraw the mark. */
function BrandMark({
  variant = 'lockup',
  size = 'md',
  assetBase = '/assets/logo',
  href,
  className = '',
  ...rest
}) {
  const cls = ['ws-brand', size !== 'md' ? `ws-brand--${size}` : '', className].filter(Boolean).join(' ');
  /* One artwork, three theme-matched files. CSS shows exactly one. */
  const mark = ['mint', 'ink', 'white'].map(tone => React.createElement('img', {
    key: tone,
    className: `ws-brand__mark ws-brand__mark--${tone}`,
    src: `${assetBase}/woke-mark${tone === 'mint' ? '' : '-' + tone}.svg`,
    alt: '',
    'aria-hidden': 'true'
  }));
  const srLabel = variant === 'mark' && !href ? React.createElement('span', {
    className: 'ws-visually-hidden'
  }, 'WetDrool') : null;
  const word = variant === 'mark' ? null : React.createElement('span', {
    className: 'ws-brand__word'
  }, 'Woke', React.createElement('em', null, 'Social'));
  const Tag = href ? 'a' : 'span';
  return React.createElement(Tag, {
    className: cls,
    href,
    'aria-label': href ? 'WetDrool home' : undefined,
    ...rest
  }, mark, srLabel, word);
}
Object.assign(__ds_scope, { BrandMark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/BrandMark.jsx", error: String((e && e.message) || e) }); }

// components/brand/Eyebrow.jsx
try { (() => {
function Eyebrow({
  tone = 'ember',
  as = 'p',
  children,
  className = '',
  ...rest
}) {
  return React.createElement(as, {
    className: ['ws-eyebrow', tone !== 'ember' ? `ws-eyebrow--${tone}` : '', className].filter(Boolean).join(' '),
    ...rest
  }, children);
}
Object.assign(__ds_scope, { Eyebrow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Eyebrow.jsx", error: String((e && e.message) || e) }); }

// components/display/Avatar.jsx
try { (() => {
function tintFor(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 6;
  return h + 1;
}
function Avatar({
  name = '',
  src,
  size = 'md',
  shape = 'organic',
  ring = false,
  seed,
  className = '',
  ...rest
}) {
  const tint = tintFor(seed || name);
  const initial = name.trim().charAt(0).toLocaleUpperCase() || '\u2022';
  return React.createElement('span', {
    className: ['ws-avatar', size !== 'md' ? `ws-avatar--${size}` : '', tint > 1 ? `ws-avatar--tint-${tint}` : '', shape === 'square' ? 'ws-avatar--square' : '', className].filter(Boolean).join(' '),
    ...rest
  }, src ? React.createElement('img', {
    src,
    alt: ''
  }) : initial, ring ? React.createElement('span', {
    className: 'ws-avatar__ring',
    'aria-hidden': 'true'
  }) : null);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function Card({
  variant = 'default',
  accent = false,
  as = 'div',
  children,
  className = '',
  ...rest
}) {
  return React.createElement(as, {
    className: ['ws-card', variant !== 'default' ? `ws-card--${variant}` : '', accent ? 'ws-card--accent' : '', className].filter(Boolean).join(' '),
    ...rest
  }, children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/Chip.jsx
try { (() => {
function Chip({
  selected,
  size = 'md',
  interactive = true,
  leadingIcon,
  children,
  className = '',
  ...rest
}) {
  const Tag = interactive ? 'button' : 'span';
  return React.createElement(Tag, {
    type: interactive ? 'button' : undefined,
    className: ['ws-chip', size === 'lg' ? 'ws-chip--lg' : '', interactive ? '' : 'ws-chip--static', className].filter(Boolean).join(' '),
    'aria-pressed': interactive && typeof selected === 'boolean' ? String(selected) : undefined,
    ...rest
  }, leadingIcon, children);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Chip.jsx", error: String((e && e.message) || e) }); }

// components/display/SectionHeading.jsx
try { (() => {
function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'start',
  size = 'lg',
  as = 'h2',
  className = '',
  ...rest
}) {
  return React.createElement('div', {
    className: ['ws-section-heading', align === 'center' ? 'ws-section-heading--center' : '', size === 'sm' ? 'ws-section-heading--sm' : '', className].filter(Boolean).join(' '),
    ...rest
  }, eyebrow ? React.createElement(__ds_scope.Eyebrow, null, eyebrow) : null, React.createElement(as, null, title), description ? React.createElement('div', {
    className: 'ws-section-heading__desc'
  }, description) : null);
}
Object.assign(__ds_scope, { SectionHeading });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/SectionHeading.jsx", error: String((e && e.message) || e) }); }

// components/display/Skeleton.jsx
try { (() => {
function Skeleton({
  width = '100%',
  height = '0.85rem',
  block = false,
  className = '',
  style,
  ...rest
}) {
  return React.createElement('span', {
    className: ['ws-skeleton', block ? 'ws-skeleton--block' : '', className].filter(Boolean).join(' '),
    style: {
      width,
      height,
      ...style
    },
    'aria-hidden': 'true',
    ...rest
  });
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/display/StatusBadge.jsx
try { (() => {
function StatusBadge({
  tone = 'neutral',
  children,
  className = '',
  ...rest
}) {
  return React.createElement('span', {
    className: ['ws-status', tone !== 'neutral' ? `ws-status--${tone}` : '', className].filter(Boolean).join(' '),
    ...rest
  }, React.createElement('span', {
    className: 'ws-status__dot',
    'aria-hidden': 'true'
  }), children);
}
Object.assign(__ds_scope, { StatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/StatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Banner.jsx
try { (() => {
function Banner({
  tone = 'info',
  title,
  icon,
  action,
  children,
  className = '',
  ...rest
}) {
  return React.createElement('div', {
    className: ['ws-banner', `ws-banner--${tone}`, className].filter(Boolean).join(' '),
    role: tone === 'danger' ? 'alert' : 'status',
    ...rest
  }, icon ? React.createElement('span', {
    className: 'ws-banner__icon',
    'aria-hidden': 'true'
  }, icon) : null, React.createElement('div', {
    className: 'ws-banner__body'
  }, title ? React.createElement('strong', null, title) : null, React.createElement('span', null, children)), action);
}
Object.assign(__ds_scope, { Banner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Banner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function Dialog({
  title,
  description,
  actions,
  variant = 'dialog',
  open = true,
  onDismiss,
  children,
  className = '',
  ...rest
}) {
  if (!open) return null;
  return React.createElement('div', {
    className: 'ws-dialog-scrim',
    style: variant === 'sheet' ? {
      alignItems: 'end',
      padding: 0
    } : undefined,
    onClick: onDismiss
  }, React.createElement('div', {
    className: ['ws-dialog', variant === 'sheet' ? 'ws-dialog--sheet' : '', className].filter(Boolean).join(' '),
    role: variant === 'sheet' ? 'dialog' : 'alertdialog',
    'aria-modal': 'true',
    'aria-label': typeof title === 'string' ? title : undefined,
    onClick: e => e.stopPropagation(),
    ...rest
  }, variant === 'sheet' ? React.createElement('span', {
    className: 'ws-dialog__handle',
    'aria-hidden': 'true'
  }) : null, React.createElement('h2', null, title), description ? React.createElement('p', {
    className: 'ws-dialog__body'
  }, description) : null, children, actions ? React.createElement('div', {
    className: 'ws-dialog__actions'
  }, actions) : null));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/ProgressBar.jsx
try { (() => {
function ProgressBar({
  value,
  label,
  className = '',
  ...rest
}) {
  const indeterminate = typeof value !== 'number';
  return React.createElement('span', {
    className: ['ws-progress', indeterminate ? 'ws-progress--indeterminate' : '', className].filter(Boolean).join(' '),
    role: 'progressbar',
    'aria-label': label,
    'aria-valuenow': indeterminate ? undefined : Math.round(value),
    'aria-valuemin': indeterminate ? undefined : 0,
    'aria-valuemax': indeterminate ? undefined : 100,
    ...rest
  }, React.createElement('span', {
    className: 'ws-progress__bar',
    style: indeterminate ? undefined : {
      width: `${Math.max(0, Math.min(100, value))}%`
    }
  }));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StatePanel.jsx
try { (() => {
function StatePanel({
  state = 'empty',
  title,
  children,
  actions,
  icon,
  className = '',
  ...rest
}) {
  return React.createElement('section', {
    className: ['ws-state-panel', `ws-state-panel--${state}`, className].filter(Boolean).join(' '),
    'aria-busy': state === 'loading' ? 'true' : undefined,
    ...rest
  }, React.createElement('span', {
    className: 'ws-state-panel__signal',
    'aria-hidden': 'true'
  }, icon), React.createElement('div', {
    className: 'ws-state-panel__body'
  }, React.createElement('h2', null, title), React.createElement('div', {
    className: 'ws-state-panel__copy'
  }, children), actions ? React.createElement('div', {
    className: 'ws-state-panel__actions'
  }, actions) : null));
}
Object.assign(__ds_scope, { StatePanel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StatePanel.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function Toast({
  children,
  action,
  actionLabel,
  icon,
  className = '',
  ...rest
}) {
  return React.createElement('div', {
    className: ['ws-toast', className].filter(Boolean).join(' '),
    role: 'status',
    'aria-live': 'polite',
    ...rest
  }, icon ? React.createElement('span', {
    'aria-hidden': 'true'
  }, icon) : null, React.createElement('span', null, children), actionLabel ? React.createElement('button', {
    type: 'button',
    className: 'ws-toast__action',
    onClick: action
  }, actionLabel) : null);
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function Checkbox({
  label,
  description,
  type = 'checkbox',
  className = '',
  ...rest
}) {
  return React.createElement('label', {
    className: ['ws-choice', className].filter(Boolean).join(' ')
  }, React.createElement('input', {
    type,
    ...rest
  }), React.createElement('span', {
    className: `ws-choice__box${type === 'radio' ? ' ws-choice__box--radio' : ''}`,
    'aria-hidden': 'true'
  }, React.createElement('svg', {
    className: 'ws-choice__mark',
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 3.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  }, type === 'radio' ? React.createElement('circle', {
    cx: 12,
    cy: 12,
    r: 5,
    fill: 'currentColor',
    stroke: 'none'
  }) : React.createElement('polyline', {
    points: '20 6 9 17 4 12'
  }))), React.createElement('span', {
    className: 'ws-choice__text'
  }, React.createElement('span', {
    className: 'ws-choice__title'
  }, label), description ? React.createElement('span', {
    className: 'ws-choice__desc'
  }, description) : null));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Field.jsx
try { (() => {
function Field({
  id,
  label,
  as = 'input',
  optional = false,
  help,
  error,
  counter,
  className = '',
  ...rest
}) {
  const controlId = id || `ws-field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(' ') || undefined;
  return React.createElement('div', {
    className: ['ws-field', className].filter(Boolean).join(' ')
  }, React.createElement('label', {
    className: 'ws-field__label',
    htmlFor: controlId
  }, React.createElement('span', null, label), optional ? React.createElement('span', {
    className: 'ws-field__optional'
  }, 'Optional') : null), React.createElement(as, {
    id: controlId,
    className: 'ws-field__control',
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy,
    ...rest
  }), error ? React.createElement('p', {
    className: 'ws-field__error',
    id: errorId
  }, React.createElement('span', {
    'aria-hidden': 'true'
  }, '\u26A0'), error) : null, help || counter ? React.createElement('div', {
    className: 'ws-field__foot'
  }, React.createElement('span', {
    className: 'ws-field__help',
    id: helpId
  }, help || ''), counter ? React.createElement('span', {
    className: 'ws-field__counter',
    'data-over': counter.over || undefined
  }, `${counter.used}/${counter.max}`) : null) : null);
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Field.jsx", error: String((e && e.message) || e) }); }

// components/forms/SearchField.jsx
try { (() => {
function SearchField({
  label = 'Search WetDrool',
  value,
  onClear,
  className = '',
  children,
  ...rest
}) {
  return React.createElement('div', {
    className: ['ws-search', className].filter(Boolean).join(' '),
    role: 'search'
  }, children, React.createElement('input', {
    type: 'search',
    'aria-label': label,
    value,
    ...rest
  }), value && onClear ? React.createElement('button', {
    type: 'button',
    className: 'ws-iconbtn ws-iconbtn--inline',
    'aria-label': 'Clear search',
    onClick: onClear
  }, '\u2715') : null);
}
Object.assign(__ds_scope, { SearchField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SearchField.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function Select({
  label,
  id,
  options = [],
  help,
  className = '',
  ...rest
}) {
  const controlId = id || `ws-select-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return React.createElement('div', {
    className: ['ws-field', className].filter(Boolean).join(' ')
  }, React.createElement('label', {
    className: 'ws-field__label',
    htmlFor: controlId
  }, React.createElement('span', null, label)), React.createElement('span', {
    className: 'ws-select'
  }, React.createElement('select', {
    id: controlId,
    ...rest
  }, options.map(o => React.createElement('option', {
    key: o.value,
    value: o.value
  }, o.label))), React.createElement('svg', {
    className: 'ws-select__chevron',
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true'
  }, React.createElement('polyline', {
    points: '6 9 12 15 18 9'
  }))), help ? React.createElement('div', {
    className: 'ws-field__foot'
  }, React.createElement('span', null, help)) : null);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function Switch({
  label,
  description,
  className = '',
  ...rest
}) {
  return React.createElement('label', {
    className: ['ws-switch', className].filter(Boolean).join(' ')
  }, React.createElement('span', {
    className: 'ws-choice__text'
  }, React.createElement('span', {
    className: 'ws-choice__title'
  }, label), description ? React.createElement('span', {
    className: 'ws-choice__desc'
  }, description) : null), React.createElement('input', {
    type: 'checkbox',
    role: 'switch',
    ...rest
  }), React.createElement('span', {
    className: 'ws-switch__track',
    'aria-hidden': 'true'
  }, React.createElement('span', {
    className: 'ws-switch__thumb'
  })));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/icon/Icon.jsx
try { (() => {
/* WetDrool has no proprietary glyph set: the droolnet codebase draws its few
   symbols with CSS geometry and single letters. This system substitutes Lucide
   (2px round-cap strokes, the closest match to the hand-drawn $DROOL mark) and
   loads it from CDN. See readme.md → ICONOGRAPHY. */
function toPascal(name) {
  return String(name).replace(/(^|[-_ ])(\w)/g, (_, __, c) => c.toUpperCase());
}
function serialize(node) {
  if (!Array.isArray(node)) return '';
  if (typeof node[0] === 'string' && (Array.isArray(node[1]) || node[1] === undefined)) {
    return node.map(serialize).join('');
  }
  if (Array.isArray(node[0])) return node.map(serialize).join('');
  const [tag, attrs, children] = node;
  if (typeof tag !== 'string') return '';
  const a = Object.entries(attrs || {}).map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' ');
  const inner = Array.isArray(children) ? children.map(serialize).join('') : '';
  return `<${tag}${a ? ' ' + a : ''}>${inner}</${tag}>`;
}
function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  label,
  className = '',
  style,
  ...rest
}) {
  const set = typeof window !== 'undefined' && window.lucide && window.lucide.icons || null;
  const node = set ? set[toPascal(name)] || set[name] : null;
  const markup = node ? serialize(node) : '';
  return React.createElement('svg', {
    className: ['ws-icon', markup ? '' : 'ws-icon--missing', className].filter(Boolean).join(' '),
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    role: label ? 'img' : undefined,
    'aria-label': label || undefined,
    'aria-hidden': label ? undefined : 'true',
    focusable: 'false',
    style,
    dangerouslySetInnerHTML: {
      __html: markup
    },
    ...rest
  });
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/icon/Icon.jsx", error: String((e && e.message) || e) }); }

// components/navigation/MobileDock.jsx
try { (() => {
function MobileDock({
  items = [],
  current,
  label = 'Primary',
  onSelect,
  className = '',
  ...rest
}) {
  return React.createElement('nav', {
    className: ['ws-dock', className].filter(Boolean).join(' '),
    'aria-label': label,
    ...rest
  }, items.map(item => React.createElement('a', {
    key: item.value,
    href: item.href || '#',
    className: 'ws-dock__item',
    'aria-current': item.value === current ? 'page' : undefined,
    onClick: onSelect ? e => {
      e.preventDefault();
      onSelect(item.value);
    } : undefined
  }, React.createElement('span', {
    className: 'ws-dock__glyph'
  }, item.icon, item.badge ? React.createElement('span', {
    className: 'ws-dock__badge'
  }, typeof item.badge === 'number' && item.badge > 9 ? '9+' : item.badge) : null), React.createElement('span', null, item.label))));
}
Object.assign(__ds_scope, { MobileDock });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/MobileDock.jsx", error: String((e && e.message) || e) }); }

// components/navigation/NavRail.jsx
try { (() => {
function NavRail({
  items = [],
  current,
  labelled = false,
  label = 'Primary',
  header,
  footer,
  onSelect,
  className = '',
  ...rest
}) {
  return React.createElement('nav', {
    className: ['ws-rail', labelled ? 'ws-rail--labelled' : '', className].filter(Boolean).join(' '),
    'aria-label': label,
    ...rest
  }, header, items.map(item => React.createElement('a', {
    key: item.value,
    href: item.href || '#',
    className: 'ws-rail__item',
    'aria-current': item.value === current ? 'page' : undefined,
    onClick: onSelect ? e => {
      e.preventDefault();
      onSelect(item.value);
    } : undefined,
    'aria-label': labelled ? undefined : item.label,
    title: labelled ? undefined : item.label
  }, item.icon, labelled ? React.createElement('span', null, item.label) : null)), footer);
}
Object.assign(__ds_scope, { NavRail });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/NavRail.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function Tabs({
  items = [],
  value,
  onChange,
  variant = 'underline',
  label = 'Sections',
  className = '',
  ...rest
}) {
  return React.createElement('div', {
    className: ['ws-tabs', variant === 'pill' ? 'ws-tabs--pill' : '', className].filter(Boolean).join(' '),
    role: 'tablist',
    'aria-label': label,
    ...rest
  }, items.map(item => React.createElement(item.href ? 'a' : 'button', {
    key: item.value,
    type: item.href ? undefined : 'button',
    href: item.href,
    role: 'tab',
    className: 'ws-tabs__tab',
    'aria-selected': String(item.value === value),
    tabIndex: item.value === value ? 0 : -1,
    onClick: onChange ? () => onChange(item.value) : undefined
  }, item.icon, item.label)));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/navigation/ThemePicker.jsx
try { (() => {
const THEMES = [{
  value: 'light',
  label: 'Light'
}, {
  value: 'dark',
  label: 'Dark'
}, {
  value: 'contrast',
  label: 'High contrast'
}];
function ThemePicker({
  value = 'dark',
  onChange,
  className = '',
  ...rest
}) {
  return React.createElement('div', {
    className: ['ws-theme-picker', className].filter(Boolean).join(' '),
    role: 'group',
    'aria-label': 'Appearance',
    ...rest
  }, THEMES.map(t => React.createElement('button', {
    key: t.value,
    type: 'button',
    'aria-pressed': String(value === t.value),
    onClick: () => {
      if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', t.value);
      if (onChange) onChange(t.value);
    }
  }, t.label)));
}
Object.assign(__ds_scope, { ThemePicker });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/ThemePicker.jsx", error: String((e && e.message) || e) }); }

// components/social/CommunityCard.jsx
try { (() => {
function CommunityCard({
  name,
  members,
  description,
  tags = [],
  action,
  moderation,
  className = '',
  ...rest
}) {
  return React.createElement('article', {
    className: ['ws-community', className].filter(Boolean).join(' '),
    ...rest
  }, React.createElement('div', {
    className: 'ws-community__head'
  }, React.createElement(__ds_scope.Avatar, {
    name,
    shape: 'square',
    seed: name
  }), React.createElement('div', {
    style: {
      minWidth: 0
    }
  }, React.createElement('h3', {
    className: 'ws-community__name'
  }, name), React.createElement('p', {
    className: 'ws-community__meta'
  }, members))), React.createElement('p', {
    className: 'ws-community__desc'
  }, description), moderation, React.createElement('div', {
    className: 'ws-community__foot'
  }, React.createElement('div', {
    style: {
      display: 'flex',
      gap: '0.35rem',
      flexWrap: 'wrap'
    }
  }, tags), action));
}
Object.assign(__ds_scope, { CommunityCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/social/CommunityCard.jsx", error: String((e && e.message) || e) }); }

// components/social/ComposerBar.jsx
try { (() => {
function ComposerBar({
  author = {},
  placeholder = "What's happening in your world?",
  tools,
  audience,
  submit,
  status,
  className = '',
  ...rest
}) {
  return React.createElement('section', {
    className: ['ws-composer', className].filter(Boolean).join(' '),
    'aria-label': 'Write a post',
    ...rest
  }, React.createElement('div', {
    className: 'ws-composer__row'
  }, React.createElement(__ds_scope.Avatar, {
    name: author.name,
    src: author.avatar,
    seed: author.id
  }), React.createElement('textarea', {
    className: 'ws-composer__input',
    placeholder,
    'aria-label': 'Post text',
    rows: 3
  })), status, React.createElement('div', {
    className: 'ws-composer__tools'
  }, React.createElement('div', {
    className: 'ws-composer__toolset'
  }, tools), React.createElement('div', {
    className: 'ws-composer__submit'
  }, audience, submit)));
}
Object.assign(__ds_scope, { ComposerBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/social/ComposerBar.jsx", error: String((e && e.message) || e) }); }

// components/social/EventCard.jsx
try { (() => {
function EventCard({
  day,
  month,
  title,
  meta,
  action,
  className = '',
  ...rest
}) {
  return React.createElement('article', {
    className: ['ws-event', className].filter(Boolean).join(' '),
    ...rest
  }, React.createElement('div', {
    className: 'ws-event__date'
  }, React.createElement('b', null, day), React.createElement('span', null, month)), React.createElement('div', {
    className: 'ws-event__body'
  }, React.createElement('h3', {
    className: 'ws-event__title'
  }, title), React.createElement('p', {
    className: 'ws-event__meta'
  }, meta), action));
}
Object.assign(__ds_scope, { EventCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/social/EventCard.jsx", error: String((e && e.message) || e) }); }

// components/social/NotificationRow.jsx
try { (() => {
function NotificationRow({
  icon,
  children,
  time,
  unread = false,
  className = '',
  ...rest
}) {
  return React.createElement('li', {
    className: ['ws-notification', unread ? 'ws-notification--unread' : '', className].filter(Boolean).join(' '),
    ...rest
  }, React.createElement('span', {
    'aria-hidden': 'true',
    style: {
      marginTop: '.15rem'
    }
  }, icon), React.createElement('div', {
    style: {
      minWidth: 0
    }
  }, React.createElement('p', {
    className: 'ws-notification__text'
  }, children), time ? React.createElement('span', {
    className: 'ws-notification__time'
  }, time) : null));
}
Object.assign(__ds_scope, { NotificationRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/social/NotificationRow.jsx", error: String((e && e.message) || e) }); }

// components/social/PostCard.jsx
try { (() => {
function PostCard({
  author = {},
  timestamp,
  body,
  media,
  contentWarning,
  contextLine,
  verification,
  lead = false,
  actions,
  footer,
  revealed = false,
  onReveal,
  className = '',
  ...rest
}) {
  return React.createElement('article', {
    className: ['ws-post', lead ? 'ws-post--lead' : '', className].filter(Boolean).join(' '),
    ...rest
  }, contextLine ? React.createElement('p', {
    className: 'ws-post__context'
  }, contextLine) : null, React.createElement('header', {
    className: 'ws-post__head'
  }, React.createElement(__ds_scope.Avatar, {
    name: author.name,
    src: author.avatar,
    seed: author.id
  }), React.createElement('div', {
    className: 'ws-post__identity'
  }, React.createElement('div', {
    className: 'ws-post__names'
  }, React.createElement('p', {
    className: 'ws-post__name'
  }, author.name), author.pronouns ? React.createElement('span', {
    className: 'ws-post__pronouns'
  }, author.pronouns) : null), React.createElement('p', {
    className: 'ws-post__meta'
  }, author.handle ? React.createElement('span', null, '@' + author.handle) : null, timestamp ? React.createElement('span', {
    'aria-hidden': 'true'
  }, '\u00B7') : null, timestamp ? React.createElement('time', null, timestamp) : null)), verification || null), contentWarning && !revealed ? React.createElement('div', {
    className: 'ws-post__cw'
  }, React.createElement('div', null, React.createElement('strong', null, contentWarning.label), React.createElement('p', null, contentWarning.detail)), React.createElement('button', {
    type: 'button',
    className: 'ws-btn ws-btn--secondary ws-btn--sm',
    onClick: onReveal
  }, 'Show anyway')) : React.createElement(React.Fragment, null, body ? React.createElement('p', {
    className: 'ws-post__body'
  }, body) : null, React.isValidElement(media) ? media : media ? React.createElement('figure', {
    className: 'ws-post__media',
    style: {
      margin: 0
    }
  }, React.createElement('img', {
    src: media.src,
    alt: media.alt || ''
  }), React.createElement('span', {
    className: 'ws-post__alt'
  }, media.alt ? 'ALT' : 'NO ALT')) : null), actions ? React.createElement('div', {
    className: 'ws-post__actions'
  }, actions) : null, footer);
}
Object.assign(__ds_scope, { PostCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/social/PostCard.jsx", error: String((e && e.message) || e) }); }

// components/social/ReactionBar.jsx
try { (() => {
function ReactionBar({
  counts = {},
  state = {},
  mutedCounts = false,
  onAction,
  extra,
  className = '',
  ...rest
}) {
  const items = [{
    key: 'replies',
    icon: 'message-circle',
    label: 'Reply',
    pressedLabel: 'Reply'
  }, {
    key: 'reposts',
    icon: 'repeat-2',
    label: 'Repost',
    pressedLabel: 'Undo repost',
    mod: 'repost'
  }, {
    key: 'likes',
    icon: 'heart',
    label: 'Appreciate',
    pressedLabel: 'Remove appreciation'
  }];
  return React.createElement('div', {
    className: ['ws-post__actions', className].filter(Boolean).join(' '),
    ...rest
  }, React.createElement('div', {
    style: {
      display: 'flex',
      gap: '0.25rem',
      flexWrap: 'wrap'
    }
  }, items.map(item => React.createElement('button', {
    key: item.key,
    type: 'button',
    className: `ws-react${item.mod ? ' ws-react--' + item.mod : ''}`,
    'aria-pressed': state[item.key] ? 'true' : 'false',
    'aria-label': `${state[item.key] ? item.pressedLabel : item.label}${counts[item.key] != null ? `, ${counts[item.key]} so far` : ''}`,
    onClick: onAction ? () => onAction(item.key) : undefined
  }, React.createElement(__ds_scope.Icon, {
    name: item.icon,
    size: 18
  }), React.createElement('span', {
    className: 'ws-react__count',
    'data-muted': mutedCounts || undefined,
    'aria-hidden': 'true'
  }, counts[item.key] != null ? counts[item.key] : '')))), extra);
}
Object.assign(__ds_scope, { ReactionBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/social/ReactionBar.jsx", error: String((e && e.message) || e) }); }

// components/trust/ProviderHealthNotice.jsx
try { (() => {
function ProviderHealthNotice({
  name,
  status,
  detail,
  action,
  icon,
  className = '',
  ...rest
}) {
  return React.createElement('div', {
    className: ['ws-provider', className].filter(Boolean).join(' '),
    role: 'status',
    ...rest
  }, icon ? React.createElement('span', {
    'aria-hidden': 'true',
    style: {
      marginTop: '.15rem'
    }
  }, icon) : null, React.createElement('div', {
    className: 'ws-provider__body'
  }, React.createElement('p', {
    className: 'ws-provider__name'
  }, name), React.createElement('p', {
    className: 'ws-provider__copy'
  }, detail)), status, action);
}
Object.assign(__ds_scope, { ProviderHealthNotice });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/trust/ProviderHealthNotice.jsx", error: String((e && e.message) || e) }); }

// components/trust/TransactionStatus.jsx
try { (() => {
function TransactionStatus({
  title,
  description,
  steps = [],
  badge,
  actions,
  className = '',
  ...rest
}) {
  return React.createElement('section', {
    className: ['ws-tx', className].filter(Boolean).join(' '),
    'aria-live': 'polite',
    ...rest
  }, React.createElement('div', {
    className: 'ws-tx__head'
  }, React.createElement('div', null, React.createElement('h3', {
    className: 'ws-tx__title'
  }, title), description ? React.createElement('p', {
    className: 'ws-tx__copy'
  }, description) : null), badge), steps.length ? React.createElement('ol', {
    className: 'ws-tx__steps'
  }, steps.map(step => React.createElement('li', {
    key: step.label,
    className: 'ws-tx__step',
    'data-state': step.state
  }, React.createElement('span', {
    className: 'ws-tx__bullet',
    'aria-hidden': 'true'
  }, step.state === 'done' ? React.createElement(__ds_scope.Icon, {
    name: 'check',
    size: 13,
    strokeWidth: 3
  }) : step.state === 'failed' ? React.createElement(__ds_scope.Icon, {
    name: 'x',
    size: 13,
    strokeWidth: 3
  }) : null), React.createElement('span', null, step.label)))) : null, actions ? React.createElement('div', {
    className: 'ws-dialog__actions',
    style: {
      justifyContent: 'flex-start'
    }
  }, actions) : null);
}
Object.assign(__ds_scope, { TransactionStatus });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/trust/TransactionStatus.jsx", error: String((e && e.message) || e) }); }

// components/trust/VerificationDetail.jsx
try { (() => {
function VerificationDetail({
  summary = 'Verification details',
  rows = [],
  note,
  className = '',
  ...rest
}) {
  return React.createElement('details', {
    className: ['ws-proof', className].filter(Boolean).join(' '),
    ...rest
  }, React.createElement('summary', null, summary), React.createElement('dl', null, rows.map(row => React.createElement('div', {
    key: row.label
  }, React.createElement('dt', null, row.label), React.createElement('dd', null, row.mono ? React.createElement('code', null, row.value) : row.value)))), note ? React.createElement('p', {
    className: 'ws-provider__copy',
    style: {
      paddingBottom: '.75rem'
    }
  }, note) : null);
}
Object.assign(__ds_scope, { VerificationDetail });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/trust/VerificationDetail.jsx", error: String((e && e.message) || e) }); }

// components/trust/WalletConnectCard.jsx
try { (() => {
function WalletConnectCard({
  title,
  description,
  permissions = [],
  actions,
  badge,
  footnote,
  className = '',
  ...rest
}) {
  return React.createElement('section', {
    className: ['ws-wallet', className].filter(Boolean).join(' '),
    ...rest
  }, React.createElement('div', {
    className: 'ws-tx__head'
  }, React.createElement('div', null, React.createElement('h3', {
    className: 'ws-tx__title'
  }, title), description ? React.createElement('p', {
    className: 'ws-tx__copy'
  }, description) : null), badge), permissions.length ? React.createElement('ul', {
    className: 'ws-wallet__perms'
  }, permissions.map(p => React.createElement('li', {
    key: p.title,
    className: 'ws-wallet__perm'
  }, React.createElement(__ds_scope.Icon, {
    name: p.allowed ? 'check' : 'x',
    size: 17,
    style: {
      color: p.allowed ? 'var(--ws-status-success)' : 'var(--ws-text-muted)',
      marginTop: '.15rem'
    }
  }), React.createElement('span', null, React.createElement('b', null, p.title), ' ', p.detail)))) : null, actions ? React.createElement('div', {
    className: 'ws-dialog__actions',
    style: {
      justifyContent: 'flex-start'
    }
  }, actions) : null, footnote ? React.createElement('p', {
    className: 'ws-provider__copy'
  }, footnote) : null);
}
Object.assign(__ds_scope, { WalletConnectCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/trust/WalletConnectCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/Landing.jsx
try { (() => {
function MkHeader() {
  const {
    BrandMark,
    Button,
    Icon
  } = window.WetDroolDesignSystem_273eab;
  return /*#__PURE__*/React.createElement("header", {
    className: "mk-header"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-shell mk-header__inner"
  }, /*#__PURE__*/React.createElement(BrandMark, {
    href: "#",
    assetBase: "../../assets/logo"
  }), /*#__PURE__*/React.createElement("ul", {
    className: "mk-nav"
  }, ['Why WetDrool', 'Safety', 'Communities', 'DroolNet', 'For developers'].map(l => /*#__PURE__*/React.createElement("li", {
    key: l
  }, /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, l)))), /*#__PURE__*/React.createElement("div", {
    className: "mk-header__actions"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "quiet",
    size: "sm",
    href: "#"
  }, "Sign in"), /*#__PURE__*/React.createElement(Button, {
    variant: "signal",
    size: "sm",
    href: "#",
    trailingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 17
    })
  }, "Create account"))));
}
function HeroObject() {
  const {
    PostCard,
    StatusBadge,
    ReactionBar,
    Card,
    Icon
  } = window.WetDroolDesignSystem_273eab;
  return /*#__PURE__*/React.createElement("div", {
    className: "mk-hero__object"
  }, /*#__PURE__*/React.createElement(PostCard, {
    author: {
      id: 'acct_8812',
      name: 'Ro Mbeki',
      handle: 'ro',
      pronouns: 'they/them'
    },
    timestamp: "4h",
    verification: /*#__PURE__*/React.createElement(StatusBadge, {
      tone: "verified"
    }, "Verified"),
    body: "The zine printer at the community centre is fixed. Thursday sessions are back on \u2014 bring paper, bring nothing, bring a friend.",
    actions: /*#__PURE__*/React.createElement(ReactionBar, {
      counts: {
        replies: 12,
        reposts: 4,
        likes: 88
      }
    }),
    style: {
      width: '100%',
      boxShadow: 'var(--ws-elevation-2)'
    }
  }), /*#__PURE__*/React.createElement(Card, {
    variant: "raised",
    accent: true,
    style: {
      width: '86%'
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "ws-eyebrow"
  }, "Feed recipe"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: '.5rem',
      fontSize: 14,
      color: 'var(--ws-text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '.5rem',
      color: 'var(--ws-text-primary)',
      fontWeight: 700
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 16
  }), "People you chose"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '.5rem'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 16
  }), "Newest first"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '.5rem'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "circle-slash",
    size: 16
  }), "Nothing inserted"))));
}
function Landing() {
  const {
    Button,
    StatusBadge,
    SectionHeading,
    Icon,
    BrandMark
  } = window.WetDroolDesignSystem_273eab;
  const VALUES = [{
    m: '01',
    t: 'Identity that leaves with you',
    c: 'A handle is for people. Portable proof is for moving. Wallet details stay out of the way until a decision truly needs them.'
  }, {
    m: '02',
    t: 'Feeds with an explanation',
    c: 'Choose chronological, following, community, or a third-party feed — and ask why any recommendation appeared.'
  }, {
    m: '03',
    t: 'Safety with visible authority',
    c: 'Personal, community and service controls stay distinct, so every action can say who made it and where it applies.'
  }];
  const LAYERS = [{
    k: 'mint',
    l: 'Identity',
    t: 'Portable roots',
    c: 'Passkeys, linked devices and recovery that never puts your email on a public ledger.'
  }, {
    k: 'violet',
    l: 'Content',
    t: 'Signed manifests',
    c: 'Public posts carry a signature, a hash, an audience, alt text and an honest storage policy.'
  }, {
    k: 'ember',
    l: 'Choice',
    t: 'Replaceable services',
    c: 'Indexers, gateways and feed providers are conveniences — not the owner of your identity.'
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "mk"
  }, /*#__PURE__*/React.createElement(MkHeader, null), /*#__PURE__*/React.createElement("section", {
    className: "mk-shell mk-hero",
    "aria-labelledby": "hero-title"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-hero__copy"
  }, /*#__PURE__*/React.createElement(StatusBadge, {
    tone: "pending"
  }, "Foundation preview"), /*#__PURE__*/React.createElement("p", {
    className: "ws-eyebrow"
  }, "The social web, awake"), /*#__PURE__*/React.createElement("h1", {
    id: "hero-title"
  }, "Own your voice.", /*#__PURE__*/React.createElement("span", null, "Choose your crowd."), /*#__PURE__*/React.createElement("em", null, "Keep the keys.")), /*#__PURE__*/React.createElement("p", {
    className: "mk-hero__lede"
  }, "WetDrool is an affirming social network where your identity is portable, your feed is inspectable, and safety does not require one company to become the world's speech authority."), /*#__PURE__*/React.createElement("div", {
    className: "mk-hero__actions"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "signal",
    size: "lg",
    trailingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 18
    })
  }, "Create your account"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg"
  }, "See how it works")), /*#__PURE__*/React.createElement("ul", {
    className: "mk-promises",
    "aria-label": "Product commitments"
  }, /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 15
  }), "No platform token"), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 15
  }), "No wallet wall"), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 15
  }), "No opaque success states"))), /*#__PURE__*/React.createElement(HeroObject, null)), /*#__PURE__*/React.createElement("div", {
    className: "mk-strip"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-shell mk-strip__inner"
  }, /*#__PURE__*/React.createElement("p", null, /*#__PURE__*/React.createElement("strong", null, "Honest by default."), " You never need a wallet, a token or a crypto vocabulary to read, post, join a community or protect yourself. When something is unavailable, we say so instead of pretending."), /*#__PURE__*/React.createElement(Button, {
    variant: "quiet",
    size: "sm",
    trailingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 16
    })
  }, "Read the principles"))), /*#__PURE__*/React.createElement("section", {
    className: "mk-shell mk-section"
  }, /*#__PURE__*/React.createElement(SectionHeading, {
    as: "h2",
    eyebrow: "Built around people",
    title: /*#__PURE__*/React.createElement(React.Fragment, null, "Familiar where it helps.", /*#__PURE__*/React.createElement("br", null), "Portable where it matters."),
    description: /*#__PURE__*/React.createElement("p", null, "You should not need to understand infrastructure to join a conversation, protect yourself, or know what happens when you press publish.")
  }), /*#__PURE__*/React.createElement("div", {
    className: "mk-values"
  }, VALUES.map(v => /*#__PURE__*/React.createElement("article", {
    className: "mk-value",
    key: v.m
  }, /*#__PURE__*/React.createElement("span", {
    className: "mk-value__marker"
  }, v.m), /*#__PURE__*/React.createElement("h3", null, v.t), /*#__PURE__*/React.createElement("p", null, v.c))))), /*#__PURE__*/React.createElement("section", {
    className: "mk-foundation"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-shell mk-section"
  }, /*#__PURE__*/React.createElement(SectionHeading, {
    as: "h2",
    align: "center",
    eyebrow: "One protocol, many doors",
    title: "A network should survive its favourite app.",
    description: /*#__PURE__*/React.createElement("p", null, "DroolNet is the protocol layer underneath. You will almost never see it \u2014 and that is the point.")
  }), /*#__PURE__*/React.createElement("div", {
    className: "mk-layers"
  }, LAYERS.map(l => /*#__PURE__*/React.createElement("article", {
    className: 'mk-layer mk-layer--' + l.k,
    key: l.l
  }, /*#__PURE__*/React.createElement("p", {
    className: "ws-eyebrow ws-eyebrow--muted"
  }, l.l), /*#__PURE__*/React.createElement("h3", null, l.t), /*#__PURE__*/React.createElement("p", null, l.c)))), /*#__PURE__*/React.createElement("div", {
    className: "mk-cta"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "ws-eyebrow"
  }, "Start with proof"), /*#__PURE__*/React.createElement("h2", null, "The feed refuses to invent a network."), /*#__PURE__*/React.createElement("p", null, "Connect a compatible indexer and you see its real response. Without one you get a useful degraded state \u2014 not demo content pretending to be live.")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg"
  }, "Open the honest feed")))), /*#__PURE__*/React.createElement("section", {
    className: "mk-shell mk-closing"
  }, /*#__PURE__*/React.createElement("p", {
    className: "ws-eyebrow"
  }, "WetDrool"), /*#__PURE__*/React.createElement("h2", null, "Bold enough to be joyful.", /*#__PURE__*/React.createElement("span", null, "Serious enough to earn trust.")), /*#__PURE__*/React.createElement("div", {
    className: "mk-closing__row"
  }, /*#__PURE__*/React.createElement("p", null, "Explicitly LGBTQ+ affirming and trans-owned. Open to everyone who honours the community's safety standards. Never dependent on disclosing your gender, your sexuality, a legal name, or a visible wallet address."), /*#__PURE__*/React.createElement(Button, {
    variant: "signal",
    size: "lg",
    trailingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 18
    })
  }, "Create your account"))), /*#__PURE__*/React.createElement("footer", {
    className: "mk-footer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-shell"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-footer__inner"
  }, /*#__PURE__*/React.createElement("div", {
    className: "mk-footer__statement"
  }, /*#__PURE__*/React.createElement(BrandMark, {
    size: "lg",
    assetBase: "../../assets/logo"
  }), /*#__PURE__*/React.createElement("p", null, "Own your voice. Choose your horizon.")), /*#__PURE__*/React.createElement("nav", {
    "aria-label": "Footer"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", null, "Product"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Feeds"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Communities"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Events"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Messages")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", null, "Trust"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Safety centre"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Moderation"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Privacy"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Provider status")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", null, "Open"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "DroolNet protocol"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "For developers"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Source"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Accessibility")))), /*#__PURE__*/React.createElement("div", {
    className: "mk-fine"
  }, /*#__PURE__*/React.createElement("p", null, "wetdrool.com \xB7 droolhouse.com redirects here. DroolNet is WetDrool's protocol layer on Solana. There is no $DROOL mint, no token sale and no token-gated feature."), /*#__PURE__*/React.createElement("p", null, "\xA9 2026 WetDrool")))));
}
Object.assign(window, {
  Landing,
  MkHeader,
  HeroObject
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/Landing.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prototype/PAI.jsx
try { (() => {
function PAI({
  points,
  addPoints
}) {
  const {
    Card,
    Button,
    Icon,
    Banner,
    Chip
  } = window.WetDroolDesignSystem_273eab;
  const [model, setModel] = React.useState('kairos');
  const m = window.PROTO.models.find(x => x.id === model);
  const SUITE = [{
    i: 'clapperboard',
    t: 'Video generation',
    d: 'Script → storyboard → cut. Renders on the Drool AI cluster.',
    c: '60 pts / min'
  }, {
    i: 'image',
    t: 'Image generation',
    d: 'Post art, thumbnails, item concepts for the marketplace.',
    c: '6 pts / image'
  }, {
    i: 'pen-line',
    t: 'Post drafting',
    d: 'Drafts in your voice from a rough note. You always approve before it posts.',
    c: '2 pts / draft'
  }, {
    i: 'activity',
    t: 'Engagement optimizer',
    d: 'Watches replies, suggests when to post, flags pile-ons early.',
    c: '10 pts / week'
  }];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h1", {
    className: "pr-h2",
    style: {
      margin: 0
    }
  }, "Drool AI"), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede"
  }, "Three models, one rule: your points are the meter. No separate credits, no expiring packs \u2014 the same points you earn by contributing."), /*#__PURE__*/React.createElement("div", {
    className: "pr-grid2",
    style: {
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8
    },
    role: "radiogroup",
    "aria-label": "Model"
  }, window.PROTO.models.map(x => /*#__PURE__*/React.createElement("div", {
    key: x.id,
    className: "pr-model",
    "data-on": model === x.id,
    role: "radio",
    "aria-checked": model === x.id,
    tabIndex: 0,
    onClick: () => setModel(x.id),
    onKeyDown: e => (e.key === 'Enter' || e.key === ' ') && setModel(x.id)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: x.id === 'athena' ? 'brain' : x.id === 'kairos' ? 'scale' : 'zap',
    size: 18,
    style: {
      marginTop: 2
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("b", null, x.name), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ws-brand-on-subtle)',
      fontWeight: 800
    }
  }, x.tag), /*#__PURE__*/React.createElement("span", null, x.desc), /*#__PURE__*/React.createElement("span", {
    style: {
      fontVariantNumeric: 'tabular-nums'
    }
  }, x.cost))))), /*#__PURE__*/React.createElement(Banner, {
    tone: "info",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "server",
      size: 17
    }),
    title: "Served by Drool AI, Inc. (pinkman.ai)"
  }, "Open-weight models fine-tuned on crypto, content and community craft \u2014 learning from the platform, growing sharper and, yes, more woke by the day.")), /*#__PURE__*/React.createElement("div", {
    className: "pr-chat",
    "aria-label": "Chat with Drool AI"
  }, /*#__PURE__*/React.createElement(Chip, {
    interactive: false,
    leadingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "sparkles",
      size: 14
    })
  }, m.name), /*#__PURE__*/React.createElement("div", {
    className: "pr-msg pr-msg--you"
  }, "Draft a post announcing my saturn-ring halo is live in the marketplace. Keep my tone, no hype."), /*#__PURE__*/React.createElement("div", {
    className: "pr-msg pr-msg--ai"
  }, /*#__PURE__*/React.createElement("b", null, "Draft \xB7 2 pts"), /*#__PURE__*/React.createElement("br", null), "\"The saturn-ring halo is live. 180 points, and every remix of it earns you a cut too. Made it for my own blob first \u2014 turns out orbit suits everyone.\"", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ws-text-muted)'
    }
  }, "Nothing posts until you approve it.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 'auto'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: () => addPoints(-2, 'Woke ' + m.name.split(' ')[1] + ' — post draft')
  }, "Approve & post \xB7 2 pts"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "quiet"
  }, "Redraft")))), /*#__PURE__*/React.createElement("h2", {
    className: "pr-h2"
  }, "Creation suite"), /*#__PURE__*/React.createElement("div", {
    className: "pr-grid2"
  }, SUITE.map(s => /*#__PURE__*/React.createElement(Card, {
    key: s.t
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: s.i,
    size: 20,
    style: {
      marginTop: 2,
      color: 'var(--ws-brand-on-subtle)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 15
    }
  }, s.t), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--ws-text-secondary)',
      lineHeight: 1.55
    }
  }, s.d))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "pr-earn"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "hexagon",
    size: 13
  }), s.c), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary"
  }, "Open"))))), /*#__PURE__*/React.createElement(Banner, {
    tone: "moderation",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "tag",
      size: 17
    }),
    title: "Everything generated is labelled"
  }, "AI-made media carries a visible \"Made with Drool AI\" chip, on the post and in its provenance record. No exceptions, including for us."));
}
Object.assign(window, {
  PAI
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prototype/PAI.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prototype/PApp.jsx
try { (() => {
function PApp() {
  const [route, setRoute] = React.useState('home');
  const [points, setPoints] = React.useState(window.PROTO.me.points);
  const [handle, setHandle] = React.useState(window.PROTO.me.handle);
  const [toast, setToast] = React.useState(null);
  const addPoints = (d, label) => {
    if (d) setPoints(p => p + d);
    if (label) {
      setToast((d > 0 ? '+' : '') + d + ' pts · ' + label);
      window.clearTimeout(window.__pt);
      window.__pt = window.setTimeout(() => setToast(null), 3500);
    }
  };
  const {
    Toast,
    Icon
  } = window.WetDroolDesignSystem_273eab;
  const screens = {
    home: /*#__PURE__*/React.createElement(window.PFeed, {
      addPoints: addPoints
    }),
    video: /*#__PURE__*/React.createElement(window.PVideo, null),
    ai: /*#__PURE__*/React.createElement(window.PAI, {
      points: points,
      addPoints: addPoints
    }),
    studio: /*#__PURE__*/React.createElement(window.PStudio, {
      points: points,
      addPoints: addPoints
    }),
    wallet: /*#__PURE__*/React.createElement(window.PWallet, {
      points: points,
      addPoints: addPoints,
      handle: handle,
      setHandle: setHandle
    }),
    plus: /*#__PURE__*/React.createElement(window.PPlus, {
      addPoints: addPoints
    })
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(window.PShell, {
    route: route,
    setRoute: setRoute,
    points: points
  }, screens[route]), toast ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      bottom: 20,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 120
    }
  }, /*#__PURE__*/React.createElement(Toast, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "hexagon",
      size: 15
    })
  }, toast)) : null);
}
Object.assign(window, {
  PApp
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prototype/PApp.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prototype/PFeed.jsx
try { (() => {
function ProtoPost({
  post,
  addPoints
}) {
  const {
    PostCard,
    ReactionBar,
    StatusBadge,
    IconButton,
    Icon
  } = window.WetDroolDesignSystem_273eab;
  const [liked, setLiked] = React.useState(false);
  return /*#__PURE__*/React.createElement(PostCard, {
    author: post.author,
    timestamp: post.time,
    contextLine: post.context ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
      name: "megaphone",
      size: 13
    }), post.context) : null,
    verification: /*#__PURE__*/React.createElement(StatusBadge, {
      tone: post.verified
    }, post.verified === 'verified' ? 'Verified human' : 'Waiting for confirmation'),
    body: post.body,
    actions: /*#__PURE__*/React.createElement(ReactionBar, {
      counts: {
        ...post.counts,
        likes: post.counts.likes + (liked ? 1 : 0)
      },
      state: {
        likes: liked
      },
      onAction: k => {
        if (k === 'likes') {
          setLiked(!liked);
          addPoints(liked ? 0 : 1, liked ? null : 'Appreciation sent');
        }
      },
      extra: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
        className: "pr-earn"
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "hexagon",
        size: 13
      }), post.earned), /*#__PURE__*/React.createElement(IconButton, {
        label: "Share this post",
        inline: true
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "share-2",
        size: 18
      })))
    })
  });
}
function PFeed({
  addPoints
}) {
  const {
    ComposerBar,
    Tabs,
    Chip,
    Button,
    IconButton,
    Icon,
    Banner
  } = window.WetDroolDesignSystem_273eab;
  const [tab, setTab] = React.useState('foryou');
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ComposerBar, {
    author: {
      name: 'quietfox2481',
      id: 'me'
    },
    placeholder: "Say it. Earn it.",
    tools: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(IconButton, {
      label: "Add photo or video",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "image",
      size: 18
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Generate with Drool AI",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "sparkles",
      size: 18
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Add a poll",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "chart-no-axes-column",
      size: 18
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Add a content warning",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "eye-off",
      size: 18
    }))),
    audience: /*#__PURE__*/React.createElement(Chip, {
      leadingIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "globe",
        size: 14
      })
    }, "Everyone"),
    submit: /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "Post"),
    status: /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: 12,
        color: 'var(--ws-text-muted)'
      }
    }, "Quality posts earn points from the people who appreciate them \u2014 not from posting volume.")
  }), /*#__PURE__*/React.createElement(Tabs, {
    label: "Feed source",
    value: tab,
    onChange: setTab,
    items: [{
      value: 'foryou',
      label: 'For you'
    }, {
      value: 'following',
      label: 'Following'
    }, {
      value: 'latest',
      label: 'Latest'
    }, {
      value: 'earning',
      label: 'Top earning'
    }]
  }), tab === 'foryou' ? /*#__PURE__*/React.createElement(Banner, {
    tone: "info",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "info",
      size: 18
    }),
    title: "Ranked by contribution, explained on request"
  }, "For you weighs appreciations, remixes and helpful replies \u2014 never watch-time tricks. ", /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "See the open ranking recipe"), ".") : null, window.PROTO.posts.map(p => /*#__PURE__*/React.createElement(ProtoPost, {
    key: p.id,
    post: p,
    addPoints: addPoints
  })));
}
Object.assign(window, {
  PFeed,
  ProtoPost
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prototype/PFeed.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prototype/PPlus.jsx
try { (() => {
function PPlus({
  addPoints
}) {
  const {
    Card,
    Button,
    Icon,
    Banner,
    StatusBadge,
    TransactionStatus,
    Checkbox
  } = window.WetDroolDesignSystem_273eab;
  const [step, setStep] = React.useState(0);
  const PERKS = [['hammer', 'Create marketplace items', 'Mint wearables on-chain and keep 70% of every sale.'], ['badge-check', 'Submit for verification', 'The Verified human badge — see how it works below.'], ['sparkles', 'Priority Drool AI', 'Front of the queue on Athena at peak times.'], ['undo-2', '30-day refund', 'Unhappy? Full refund inside 30 days, no questions, no forms.']];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h1", {
    className: "pr-h2",
    style: {
      margin: 0
    }
  }, "Woke Plus"), /*#__PURE__*/React.createElement("div", {
    className: "pr-grid2",
    style: {
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    accent: true
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 22,
      fontFamily: 'var(--ws-font-display)'
    }
  }, "$9.99/month \u2014 for life"), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede",
    style: {
      marginTop: 4
    }
  }, "Founding price, locked forever for the first 1,000 subscribers. 612 spots left.")), /*#__PURE__*/React.createElement(StatusBadge, {
    tone: "pending"
  }, "Founding tier")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10
    }
  }, PERKS.map(([i, t, d]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: i,
    size: 17,
    style: {
      marginTop: 2,
      color: 'var(--ws-brand-on-subtle)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      lineHeight: 1.5,
      color: 'var(--ws-text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--ws-text-primary)'
    }
  }, t, "."), " ", d)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "signal"
  }, "Subscribe \xB7 $9.99/mo"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, "Pay with points \xB7 4,000/mo")), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede",
    style: {
      fontSize: 12
    }
  }, "Dedicated contributors can cover Plus entirely with points \u2014 if you give a lot to the platform, you never have to pay.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 15
    }
  }, "Verification: prove you're a person, reveal nothing"), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede"
  }, "An end-to-end encrypted flow where AI checks your ID and a selfie, estimates age, and confirms you're you. Nothing is stored, and not even WetDrool.com can see it \u2014 the check runs sealed, then forgets."), step === 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: "I understand what's checked",
    description: "Document validity, face match, age estimate. Nothing else."
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "I understand what's kept",
    description: "Only the yes/no result. No images, no document data, ever."
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: () => setStep(1)
  }, "Start verification"))) : /*#__PURE__*/React.createElement(TransactionStatus, {
    title: "Verifying \u2014 sealed session",
    badge: /*#__PURE__*/React.createElement(StatusBadge, {
      tone: "pending"
    }, "In progress"),
    steps: [{
      label: 'Encrypted on your device',
      state: 'done'
    }, {
      label: 'Document scanned inside the enclave',
      state: 'done'
    }, {
      label: 'Selfie match + age estimate',
      state: 'active'
    }, {
      label: 'Everything deleted · badge issued',
      state: 'todo'
    }],
    description: "If this fails you can retry or appeal to a human. Failure is never announced to anyone.",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "quiet",
      onClick: () => setStep(0)
    }, "Cancel \u2014 deletes everything now")
  })), /*#__PURE__*/React.createElement(Banner, {
    tone: "info",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "scale",
      size: 17
    }),
    title: "The fair-points promise"
  }, "Points are earnable for everything money can buy here \u2014 handles, items, AI, Plus. Paying is a shortcut, never a gate."))), /*#__PURE__*/React.createElement(Card, {
    variant: "flat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pr-org"
  }, /*#__PURE__*/React.createElement("b", null, "Corporate structure"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "Pinkman, Inc."), " (Delaware C-Corp, umbrella) \u2192 ", /*#__PURE__*/React.createElement("b", null, "Woke Social, Inc."), " \xB7 ", /*#__PURE__*/React.createElement("b", null, "Drool AI, Inc."), " (pinkman.ai) \xB7 ", /*#__PURE__*/React.createElement("b", null, "ICEFAM Records, LLC"), "."))));
}
Object.assign(window, {
  PPlus
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prototype/PPlus.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prototype/PShell.jsx
try { (() => {
function PShell({
  route,
  setRoute,
  points,
  children
}) {
  const {
    BrandMark,
    NavRail,
    SearchField,
    Button,
    Icon
  } = window.WetDroolDesignSystem_273eab;
  const nav = [{
    value: 'home',
    label: 'Home',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "house",
      size: 21
    })
  }, {
    value: 'video',
    label: 'Video',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "clapperboard",
      size: 21
    })
  }, {
    value: 'ai',
    label: 'Drool AI',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "sparkles",
      size: 21
    })
  }, {
    value: 'studio',
    label: 'Avatar studio',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "shirt",
      size: 21
    })
  }, {
    value: 'wallet',
    label: 'Wallet & points',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "wallet",
      size: 21
    })
  }, {
    value: 'plus',
    label: 'Woke Plus',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "badge-check",
      size: 21
    })
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "pr-shell"
  }, /*#__PURE__*/React.createElement("header", {
    className: "pr-appbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pr-appbar__inner"
  }, /*#__PURE__*/React.createElement(BrandMark, {
    href: "#",
    assetBase: "../../assets/logo"
  }), /*#__PURE__*/React.createElement("div", {
    className: "pr-appbar__search"
  }, /*#__PURE__*/React.createElement(SearchField, {
    placeholder: "Search WetDrool.com"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 18
  }))), /*#__PURE__*/React.createElement("div", {
    className: "pr-appbar__actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "pr-points",
    onClick: () => setRoute('wallet'),
    "aria-label": points.toLocaleString() + ' points. Open wallet.'
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "hexagon",
    size: 16
  }), points.toLocaleString(), " pts"), /*#__PURE__*/React.createElement(Button, {
    variant: "signal",
    size: "sm",
    leadingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "pen-line",
      size: 17
    }),
    onClick: () => setRoute('home')
  }, "Post")))), /*#__PURE__*/React.createElement("div", {
    className: "pr-body"
  }, /*#__PURE__*/React.createElement(NavRail, {
    labelled: true,
    current: route,
    label: "Primary",
    className: "pr-rail",
    onSelect: setRoute,
    items: nav.map(n => ({
      ...n,
      href: '#'
    }))
  }), /*#__PURE__*/React.createElement("main", {
    className: "pr-main",
    id: "main"
  }, children)), /*#__PURE__*/React.createElement("footer", {
    className: "pr-foot"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pr-org"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "Woke Social, Inc."), " and ", /*#__PURE__*/React.createElement("b", null, "Drool AI, Inc."), " (pinkman.ai) are subsidiaries of ", /*#__PURE__*/React.createElement("b", null, "Pinkman, Inc."), ", alongside ", /*#__PURE__*/React.createElement("b", null, "ICEFAM Records, LLC"), "."), /*#__PURE__*/React.createElement("span", null, "Open-source protocols, open governance. Points are earned or bought; they are not an investment. Trading tools are signals, not advice."))));
}
Object.assign(window, {
  PShell
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prototype/PShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prototype/PStudio.jsx
try { (() => {
function PStudio({
  points,
  addPoints
}) {
  const {
    Tabs,
    Button,
    Icon,
    Banner,
    Chip,
    Card,
    Avatar
  } = window.WetDroolDesignSystem_273eab;
  const [cat, setCat] = React.useState('All');
  const [owned, setOwned] = React.useState(['i3']);
  const [worn, setWorn] = React.useState(['i3']);
  const items = window.PROTO.items.filter(i => cat === 'All' || i.cat === cat);
  const wornItems = window.PROTO.items.filter(i => worn.includes(i.id));
  const base = wornItems.find(i => i.cat === 'Base');
  const buy = it => {
    if (!owned.includes(it.id) && points >= it.price) {
      setOwned([...owned, it.id]);
      setWorn([...worn, it.id]);
      addPoints(-it.price, 'Marketplace — ' + it.name);
    }
  };
  const toggleWear = it => setWorn(worn.includes(it.id) ? worn.filter(x => x !== it.id) : [...worn, it.id]);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h1", {
    className: "pr-h2",
    style: {
      margin: 0
    }
  }, "Avatar studio"), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede"
  }, "Your blob, your fit. Items are made by other users, minted on-chain when sold, and wearable everywhere on WetDrool.com. Creators keep 70% of every sale."), /*#__PURE__*/React.createElement("div", {
    className: "pr-grid2",
    style: {
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pr-avatar-stage"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pr-blob",
    style: {
      background: base ? base.tint : 'var(--ws-brand-mint)',
      color: wornItems.find(i => i.cat === 'Effects') ? wornItems.find(i => i.cat === 'Effects').tint : 'transparent'
    }
  }, wornItems.find(i => i.cat === 'Effects') ? /*#__PURE__*/React.createElement("span", {
    className: "pr-blob__halo",
    "aria-hidden": "true"
  }) : null, "q"), /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 15
    }
  }, "quietfox2481.drool"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap',
      justifyContent: 'center'
    }
  }, wornItems.length ? wornItems.map(i => /*#__PURE__*/React.createElement(Chip, {
    key: i.id,
    size: "md",
    onClick: () => toggleWear(i),
    selected: true,
    leadingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 13
    })
  }, i.name)) : /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--ws-text-muted)'
    }
  }, "Nothing equipped \u2014 pure blob.")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--ws-text-muted)'
    }
  }, "Preview uses item colours; full art renders in-app.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    label: "Item category",
    value: cat,
    onChange: setCat,
    variant: "pill",
    items: ['All', 'Base', 'Outfits', 'Headwear', 'Effects'].map(c => ({
      value: c,
      label: c
    }))
  }), /*#__PURE__*/React.createElement("div", {
    className: "pr-grid3",
    style: {
      gridTemplateColumns: 'repeat(2,1fr)'
    }
  }, items.map(it => {
    const isOwned = owned.includes(it.id);
    return /*#__PURE__*/React.createElement("button", {
      key: it.id,
      type: "button",
      className: "pr-item",
      "data-on": worn.includes(it.id),
      onClick: () => isOwned ? toggleWear(it) : buy(it)
    }, /*#__PURE__*/React.createElement("span", {
      className: "pr-item__swatch",
      style: {
        background: it.tint
      }
    }, it.cat), /*#__PURE__*/React.createElement("b", null, it.name), /*#__PURE__*/React.createElement("span", null, "by ", it.by), /*#__PURE__*/React.createElement("span", {
      className: "pr-earn"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "hexagon",
      size: 12
    }), isOwned ? worn.includes(it.id) ? 'Equipped — tap to remove' : 'Owned — tap to wear' : it.price + ' pts'));
  })))), /*#__PURE__*/React.createElement("h2", {
    className: "pr-h2"
  }, "Marketplace & creators"), /*#__PURE__*/React.createElement("div", {
    className: "pr-grid2"
  }, /*#__PURE__*/React.createElement(Card, {
    accent: true
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 15
    }
  }, "Make items, earn points, cash out"), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede"
  }, "Creators keep 70% of every sale. Points convert to SOL or $DROOL with no transaction fee. Item creation needs Woke Plus \u2014 that's the spam filter, not a paywall on creativity."), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    leadingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "hammer",
      size: 16
    })
  }, "Become a creator"))), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 15
    }
  }, "Owned items are actually yours"), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede"
  }, "Purchased items mint on-chain to your .drool wallet. Trade them, gift them, or take them to any compatible client \u2014 the marketplace is an open protocol, not a walled garden."), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "quiet"
  }, "Read the item spec")))));
}
Object.assign(window, {
  PStudio
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prototype/PStudio.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prototype/PVideo.jsx
try { (() => {
function PVideo() {
  const {
    Tabs,
    Banner,
    Icon,
    Chip,
    Button
  } = window.WetDroolDesignSystem_273eab;
  const [tab, setTab] = React.useState('shorts');
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    className: "pr-h2",
    style: {
      margin: 0
    }
  }, "Video"), /*#__PURE__*/React.createElement(Chip, {
    interactive: false,
    leadingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "gauge",
      size: 14
    })
  }, "Middle-out compression \xB7 41% less bandwidth, faster starts")), /*#__PURE__*/React.createElement(Tabs, {
    label: "Video type",
    value: tab,
    onChange: setTab,
    items: [{
      value: 'shorts',
      label: 'Shorts'
    }, {
      value: 'long',
      label: 'Long form'
    }, {
      value: 'live',
      label: 'Live'
    }]
  }), tab === 'shorts' ? /*#__PURE__*/React.createElement("div", {
    className: "pr-grid3"
  }, window.PROTO.shorts.map(s => /*#__PURE__*/React.createElement("figure", {
    key: s.id,
    className: "pr-short",
    style: {
      margin: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "pr-short__play",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "play",
    size: 22
  })), /*#__PURE__*/React.createElement("div", {
    className: "pr-short__scrim"
  }), /*#__PURE__*/React.createElement("figcaption", {
    className: "pr-short__body"
  }, /*#__PURE__*/React.createElement("p", {
    className: "pr-short__cap"
  }, s.cap), /*#__PURE__*/React.createElement("div", {
    className: "pr-short__meta"
  }, /*#__PURE__*/React.createElement("span", null, s.by), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "heart",
    size: 13
  }), s.likes, " \xB7 ", s.len, " \xB7 CC")))))) : tab === 'long' ? /*#__PURE__*/React.createElement("div", {
    className: "pr-grid2"
  }, window.PROTO.longs.map(v => /*#__PURE__*/React.createElement("article", {
    key: v.id,
    className: "pr-vid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pr-vid__thumb"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "play",
    size: 26
  }), /*#__PURE__*/React.createElement("span", {
    className: "pr-vid__len"
  }, v.len)), /*#__PURE__*/React.createElement("p", {
    className: "pr-vid__t"
  }, v.t), /*#__PURE__*/React.createElement("p", {
    className: "pr-vid__m"
  }, v.by, " \xB7 ", v.views, " \xB7 ", v.age, " \xB7 captions")))) : /*#__PURE__*/React.createElement(Banner, {
    tone: "info",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "radio",
      size: 18
    }),
    title: "Nobody you follow is live right now"
  }, "Creators you follow appear here the moment they go live. We don't page you about strangers."), /*#__PURE__*/React.createElement(Banner, {
    tone: "success",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "leaf",
      size: 18
    }),
    title: "Why video is cheap here"
  }, "Middle-out compression cuts storage and compute, so creator payouts stay high and playback stays free. ", /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "quiet"
  }, "Read the open spec")));
}
Object.assign(window, {
  PVideo
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prototype/PVideo.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prototype/PWallet.jsx
try { (() => {
function PWallet({
  points,
  addPoints,
  handle,
  setHandle
}) {
  const {
    Card,
    Button,
    Icon,
    Banner,
    Chip,
    Field,
    Switch,
    Select,
    StatusBadge,
    VerificationDetail,
    Dialog
  } = window.WetDroolDesignSystem_273eab;
  const [draft, setDraft] = React.useState('alex');
  const [confirm, setConfirm] = React.useState(false);
  const custom = !handle.match(/\d{4}\.drool$/);
  const COST = 2500;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h1", {
    className: "pr-h2",
    style: {
      margin: 0
    }
  }, "Wallet & points"), /*#__PURE__*/React.createElement("div", {
    className: "pr-grid2",
    style: {
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    accent: true
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 12,
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: 'var(--ws-font-mono)',
      fontSize: 17
    }
  }, handle), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede",
    style: {
      marginTop: 4
    }
  }, "Your username is your wallet. It was assigned at random so you stayed anonymous from day one \u2014 and it's tied to a real Solana wallet underneath.")), /*#__PURE__*/React.createElement(StatusBadge, {
    tone: "verified"
  }, "Yours on-chain")), /*#__PURE__*/React.createElement(VerificationDetail, {
    summary: "Technical details",
    rows: [{
      label: 'Domain',
      value: handle,
      mono: true
    }, {
      label: 'Resolves to',
      value: '7fUA…k2Qx (Solana)',
      mono: true
    }, {
      label: 'Registered',
      value: 'At sign-up · no fee'
    }, {
      label: 'Custody',
      value: 'Yours — export any time'
    }],
    note: "Nobody sees the raw address unless you show them. The .drool name is what the world uses."
  })), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 15
    }
  }, custom ? 'Your custom handle' : 'Claim a custom handle'), custom ? /*#__PURE__*/React.createElement("p", {
    className: "pr-lede"
  }, "You're ", /*#__PURE__*/React.createElement("b", null, handle), ". The old random name still resolves, so nothing you signed breaks.") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", {
    className: "pr-lede"
  }, "Good names can't be squatted here: custom handles are earned or bought with points, so the people holding them actually use the platform. ", COST.toLocaleString(), " pts \u2014 about a month of steady contribution."), /*#__PURE__*/React.createElement(Field, {
    label: "Pick your name",
    value: draft,
    onChange: e => setDraft(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '')),
    help: draft ? draft + '.drool is available' : 'Letters and numbers only'
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    disabled: !draft || points < COST,
    onClick: () => setConfirm(true)
  }, "Claim ", draft || '…', ".drool \xB7 ", COST.toLocaleString(), " pts"), points < COST ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--ws-text-muted)'
    }
  }, "You need ", (COST - points).toLocaleString(), " more pts") : null))), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 15
    }
  }, "Cash out"), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede"
  }, "Creator earnings convert to SOL or $DROOL with no transaction fee. Engagement points stay points \u2014 the economy rewards making things, not farming taps."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary"
  }, "Convert to SOL"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary"
  }, "Convert to $DROOL")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline'
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 15
    }
  }, "Points ledger"), /*#__PURE__*/React.createElement("span", {
    className: "pr-earn"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "hexagon",
    size: 13
  }), points.toLocaleString(), " pts")), /*#__PURE__*/React.createElement("ul", {
    className: "pr-ledger"
  }, window.PROTO.ledger.map((l, i) => /*#__PURE__*/React.createElement("li", {
    key: i
  }, /*#__PURE__*/React.createElement("span", {
    className: "t"
  }, l.t), /*#__PURE__*/React.createElement("span", null, l.what), /*#__PURE__*/React.createElement("span", {
    className: "d",
    "data-neg": l.d.startsWith('-') || undefined
  }, l.d)))), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede",
    style: {
      fontSize: 12
    }
  }, "Earn by being appreciated, boosted, remixed or helpful \u2014 never by volume. Weekly contributor shares go to the most helpful 5%, so heavy contributors ride free.")), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 15
    }
  }, "Open governance"), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede"
  }, "Protocols and ranking recipes are open source. WSIPs are voted on by contribution weight, not balance."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Chip, {
    interactive: false,
    leadingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "vote",
      size: 14
    })
  }, "WSIP-14 \xB7 voting ends in 3 days"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "quiet"
  }, "Read & vote"))))), /*#__PURE__*/React.createElement("h2", {
    className: "pr-h2"
  }, "Trading bots"), /*#__PURE__*/React.createElement(Banner, {
    tone: "warning",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "triangle-alert",
      size: 18
    }),
    title: "Signals, not advice"
  }, "Bots read public social sentiment, run AI market analysis, and pass every order through your risk filter. They trade only what you explicitly allocate, and they start in paper mode."), /*#__PURE__*/React.createElement("div", {
    className: "pr-grid2"
  }, window.PROTO.bots.map(b => /*#__PURE__*/React.createElement(Card, {
    key: b.id
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", {
    style: {
      fontSize: 15
    }
  }, b.name), /*#__PURE__*/React.createElement("p", {
    className: "pr-lede"
  }, b.strat)), /*#__PURE__*/React.createElement(StatusBadge, {
    tone: b.risk === 'Conservative' ? 'info' : 'pending'
  }, b.risk, " filter")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 6,
      fontSize: 13,
      color: 'var(--ws-text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "activity",
    size: 15
  }), "Sentiment now: ", b.signal), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chart-line",
    size: 15
  }), b.perf)), /*#__PURE__*/React.createElement(Switch, {
    label: "Paper trading",
    description: "Simulated orders only. Turning this off asks you to confirm an allocation first.",
    defaultChecked: true
  })))), /*#__PURE__*/React.createElement(Dialog, {
    open: confirm,
    title: 'Claim ' + draft + '.drool?',
    description: 'This spends ' + COST.toLocaleString() + ' points and points don\u2019t come back. Your current name keeps resolving, so old links and signatures stay valid.',
    onDismiss: () => setConfirm(false),
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: () => setConfirm(false)
    }, "Not yet"), /*#__PURE__*/React.createElement(Button, {
      onClick: () => {
        setConfirm(false);
        setHandle(draft + '.drool');
        addPoints(-COST, 'Custom handle — ' + draft + '.drool');
      }
    }, "Claim it"))
  }));
}
Object.assign(window, {
  PWallet
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prototype/PWallet.jsx", error: String((e && e.message) || e) }); }

// ui_kits/prototype/pdata.js
try { (() => {
/* WetDrool.com product-vision prototype data. Written, not generated. */
window.PROTO = {
  me: {
    handle: 'quietfox2481.drool',
    points: 3420,
    name: 'quietfox2481'
  },
  posts: [{
    id: 'v1',
    author: {
      id: 'a1',
      name: 'mintyowl.drool',
      handle: 'mintyowl.drool'
    },
    time: '2h',
    verified: 'verified',
    body: 'Shipped my first marketplace item last night \u2014 a saturn-ring halo. Woke up to 214 points and three remixes. This is what an economy that starts from contribution feels like.',
    counts: {
      replies: 18,
      reposts: 31,
      likes: 122
    },
    earned: '+61 pts'
  }, {
    id: 'v2',
    author: {
      id: 'a2',
      name: 'daedra.drool',
      handle: 'daedra.drool'
    },
    time: '5h',
    verified: 'verified',
    context: 'Boosted by Open Governance',
    body: 'WSIP-14 is up: cap AI-credit prices to a public formula instead of a dial we control. Voting is open to every account, weighted by contribution, not by balance.',
    counts: {
      replies: 44,
      reposts: 87,
      likes: 305
    },
    earned: '+153 pts'
  }, {
    id: 'v3',
    author: {
      id: 'a3',
      name: 'kairofan7.drool',
      handle: 'kairofan7.drool'
    },
    time: '9h',
    verified: 'pending',
    body: 'Asked Drool Kairos to cut my 40-minute stream into shorts. It found the three moments people actually clipped manually. 12 points well spent.',
    counts: {
      replies: 7,
      reposts: 12,
      likes: 96
    },
    earned: '+48 pts'
  }],
  shorts: [{
    id: 's1',
    by: 'daedra.drool',
    cap: 'How WSIP voting works in 90 seconds. Captions on.',
    likes: '4.1k',
    len: '1:28'
  }, {
    id: 's2',
    by: 'mintyowl.drool',
    cap: 'Speedrun: blob to full fit in the avatar studio.',
    likes: '2.8k',
    len: '0:59'
  }, {
    id: 's3',
    by: 'icefam.drool',
    cap: 'Studio session \u2014 first release on ICEFAM Records.',
    likes: '9.2k',
    len: '2:41'
  }],
  longs: [{
    id: 'l1',
    t: 'Middle-out, explained: why your feed loads twice as fast',
    by: 'droolnet.drool',
    len: '18:22',
    views: '41k views',
    age: '2d'
  }, {
    id: 'l2',
    t: 'Building a marketplace item from sketch to mint',
    by: 'mintyowl.drool',
    len: '32:05',
    views: '12k views',
    age: '4d'
  }, {
    id: 'l3',
    t: 'Governance call \u2014 WSIP-14 open discussion (recorded)',
    by: 'daedra.drool',
    len: '1:04:11',
    views: '8.4k views',
    age: '5d'
  }, {
    id: 'l4',
    t: 'Fine-tuning Athena: what \u201cwoke by the day\u201d actually means',
    by: 'wokeai.drool',
    len: '24:47',
    views: '29k views',
    age: '1w'
  }],
  models: [{
    id: 'athena',
    name: 'Drool Athena 1',
    tag: 'Flagship reasoning',
    cost: '4 pts / 1k tokens',
    desc: 'Deepest reasoning. Long analysis, research, hard drafts.'
  }, {
    id: 'kairos',
    name: 'Drool Kairos 1',
    tag: 'Balanced',
    cost: '1.5 pts / 1k tokens',
    desc: 'The everyday model. Fast, sharp, cost-effective.'
  }, {
    id: 'hermes',
    name: 'Drool Hermes 1',
    tag: 'Fast \u00b7 agentic',
    cost: '0.4 pts / 1k tokens',
    desc: 'Cheapest and fastest. Automation, monitoring, agents.'
  }],
  items: [{
    id: 'i1',
    name: 'Saturn-ring halo',
    cat: 'Effects',
    tint: '#a87eff',
    price: 180,
    by: 'mintyowl.drool'
  }, {
    id: 'i2',
    name: 'Ember bomber',
    cat: 'Outfits',
    tint: '#ff914d',
    price: 240,
    by: 'stitchwrk.drool'
  }, {
    id: 'i3',
    name: 'Mint bucket hat',
    cat: 'Headwear',
    tint: '#cff0ec',
    price: 120,
    by: 'stitchwrk.drool'
  }, {
    id: 'i4',
    name: 'Static shimmer',
    cat: 'Effects',
    tint: '#6cc9ef',
    price: 300,
    by: 'glitchpx.drool'
  }, {
    id: 'i5',
    name: 'Slate trench',
    cat: 'Outfits',
    tint: '#616c6f',
    price: 200,
    by: 'stitchwrk.drool'
  }, {
    id: 'i6',
    name: 'Violet buzz',
    cat: 'Base',
    tint: '#8c52ff',
    price: 90,
    by: 'glitchpx.drool'
  }],
  bots: [{
    id: 'b1',
    name: 'Steady Eddie',
    strat: 'Sentiment drift \u00b7 large caps',
    risk: 'Conservative',
    signal: 'Calm \u00b7 slightly bullish',
    perf: '+3.2% (30d, paper)'
  }, {
    id: 'b2',
    name: 'Momo',
    strat: 'Momentum on trending tickers',
    risk: 'Assertive',
    signal: 'Loud \u00b7 crowded \u00b7 caution',
    perf: '+11.8% (30d, paper)'
  }],
  ledger: [{
    t: 'Today',
    what: '9 appreciations on your post',
    d: '+27'
  }, {
    t: 'Today',
    what: 'Drool Kairos \u2014 shorts cut from stream',
    d: '-12'
  }, {
    t: 'Yesterday',
    what: 'Marketplace \u2014 Mint bucket hat',
    d: '-120'
  }, {
    t: 'Yesterday',
    what: 'Your reply was boosted by Sunday Kitchen',
    d: '+40'
  }, {
    t: 'Mon',
    what: 'Weekly contributor share (top 5% helpful)',
    d: '+250'
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/prototype/pdata.js", error: String((e && e.message) || e) }); }

// ui_kits/seeker/Screens.jsx
try { (() => {
function SkBar({
  title,
  actions
}) {
  const {
    BrandMark,
    IconButton,
    Icon
  } = window.WetDroolDesignSystem_273eab;
  return /*#__PURE__*/React.createElement("div", {
    className: "sk-bar"
  }, title ? /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 17,
      fontWeight: 800,
      letterSpacing: '-.01em'
    }
  }, title) : /*#__PURE__*/React.createElement(BrandMark, {
    size: "sm",
    assetBase: "../../assets/logo"
  }), /*#__PURE__*/React.createElement("div", {
    className: "sk-bar__actions"
  }, actions));
}
function SkDock({
  current
}) {
  const {
    MobileDock,
    Icon
  } = window.WetDroolDesignSystem_273eab;
  return /*#__PURE__*/React.createElement(MobileDock, {
    current: current,
    items: [{
      value: 'home',
      label: 'Home',
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "house",
        size: 22
      })
    }, {
      value: 'explore',
      label: 'Explore',
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "compass",
        size: 22
      })
    }, {
      value: 'alerts',
      label: 'Alerts',
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "bell",
        size: 22
      }),
      badge: 3
    }, {
      value: 'dms',
      label: 'Messages',
      icon: /*#__PURE__*/React.createElement(Icon, {
        name: "mail",
        size: 22
      })
    }]
  });
}
function SeekerFeed() {
  const {
    PostCard,
    ReactionBar,
    StatusBadge,
    IconButton,
    Icon,
    Fab,
    Tabs
  } = window.WetDroolDesignSystem_273eab;
  const posts = window.WS_DATA.posts.slice(0, 2);
  return /*#__PURE__*/React.createElement("div", {
    className: "sk-screen"
  }, /*#__PURE__*/React.createElement(SkBar, {
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(IconButton, {
      label: "Search",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "search",
      size: 19
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Your profile",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "user-round",
      size: 19
    })))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 12px'
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    label: "Feed source",
    value: "following",
    items: [{
      value: 'following',
      label: 'Following'
    }, {
      value: 'latest',
      label: 'Latest'
    }, {
      value: 'quiet',
      label: 'Quiet'
    }]
  })), /*#__PURE__*/React.createElement("div", {
    className: "sk-scroll"
  }, posts.map(p => /*#__PURE__*/React.createElement(PostCard, {
    key: p.id,
    author: p.author,
    timestamp: p.time,
    verification: /*#__PURE__*/React.createElement(StatusBadge, {
      tone: p.verified
    }, p.verified === 'verified' ? 'Verified' : 'Pending'),
    body: p.body,
    actions: /*#__PURE__*/React.createElement(ReactionBar, {
      counts: p.counts,
      state: {
        likes: p.id === 'p1'
      },
      extra: /*#__PURE__*/React.createElement(IconButton, {
        label: "Share",
        inline: true
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "share-2",
        size: 17
      }))
    })
  }))), /*#__PURE__*/React.createElement("div", {
    className: "sk-fab"
  }, /*#__PURE__*/React.createElement(Fab, {
    label: "Post",
    extended: false
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "pen-line",
    size: 22
  }))), /*#__PURE__*/React.createElement(SkDock, {
    current: "home"
  }));
}
function SeekerComposer() {
  const {
    ComposerBar,
    Chip,
    Button,
    IconButton,
    Icon,
    Checkbox
  } = window.WetDroolDesignSystem_273eab;
  return /*#__PURE__*/React.createElement("div", {
    className: "sk-screen",
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(SkBar, {
    title: "New post",
    actions: /*#__PURE__*/React.createElement(IconButton, {
      label: "Close",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "x",
      size: 19
    }))
  }), /*#__PURE__*/React.createElement("div", {
    className: "sk-scroll"
  }, /*#__PURE__*/React.createElement(ComposerBar, {
    author: window.WS_DATA.me,
    placeholder: "What's happening in your world?",
    tools: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(IconButton, {
      label: "Add photo or video",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "image",
      size: 19
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Add alt text",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "type",
      size: 19
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Add a content warning",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "eye-off",
      size: 19
    }))),
    audience: /*#__PURE__*/React.createElement(Chip, {
      leadingIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "users",
        size: 14
      })
    }, "Followers"),
    submit: /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "Post"),
    status: /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: 12,
        color: 'var(--ws-text-muted)'
      }
    }, "Saved on this device.")
  })), /*#__PURE__*/React.createElement("div", {
    className: "sk-sheet"
  }, /*#__PURE__*/React.createElement("span", {
    className: "sk-sheet__handle"
  }), /*#__PURE__*/React.createElement("p", {
    className: "sk-h",
    style: {
      fontSize: 20
    }
  }, "Who can see this?"), /*#__PURE__*/React.createElement(Checkbox, {
    type: "radio",
    name: "aud",
    label: "Followers",
    description: "People who follow you.",
    defaultChecked: true
  }), /*#__PURE__*/React.createElement(Checkbox, {
    type: "radio",
    name: "aud",
    label: "Trans Tech Collective",
    description: "Members of that community only."
  }), /*#__PURE__*/React.createElement(Checkbox, {
    type: "radio",
    name: "aud",
    label: "Anyone on WetDrool",
    description: "Public. Anyone can find and repost it."
  }), /*#__PURE__*/React.createElement(Button, {
    block: true
  }, "Use this audience")));
}
function SeekerWallet() {
  const {
    WalletConnectCard,
    TransactionStatus,
    StatusBadge,
    Button,
    Banner,
    Icon,
    IconButton
  } = window.WetDroolDesignSystem_273eab;
  return /*#__PURE__*/React.createElement("div", {
    className: "sk-screen"
  }, /*#__PURE__*/React.createElement(SkBar, {
    title: "Claim your handle",
    actions: /*#__PURE__*/React.createElement(IconButton, {
      label: "Close",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "x",
      size: 19
    }))
  }), /*#__PURE__*/React.createElement("div", {
    className: "sk-scroll"
  }, /*#__PURE__*/React.createElement(WalletConnectCard, {
    title: "Connect your Seeker wallet?",
    description: "Claiming @ro is the only thing that needs this. Everything else works without a wallet.",
    permissions: [{
      title: 'Ask you to approve an action.',
      allowed: true
    }, {
      title: 'Move funds on its own.',
      allowed: false
    }, {
      title: 'Read your messages.',
      allowed: false
    }],
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "Continue"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "quiet"
    }, "Not now"))
  }), /*#__PURE__*/React.createElement(TransactionStatus, {
    title: "Claiming @ro",
    badge: /*#__PURE__*/React.createElement(StatusBadge, {
      tone: "pending"
    }, "Not confirmed yet"),
    steps: [{
      label: 'Approved on your device',
      state: 'done'
    }, {
      label: 'Confirming on DroolNet',
      state: 'active'
    }, {
      label: 'Handle is yours',
      state: 'todo'
    }],
    description: "This usually takes a few seconds. You can leave this screen \u2014 we'll tell you when it's done."
  }), /*#__PURE__*/React.createElement(Banner, {
    tone: "info",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "info",
      size: 17
    })
  }, "Nothing has changed yet. Your handle stays as it is until this is confirmed.")), /*#__PURE__*/React.createElement(SkDock, {
    current: "home"
  }));
}
function SeekerAlerts() {
  const {
    NotificationRow,
    Banner,
    Button,
    Icon,
    IconButton,
    StatePanel
  } = window.WetDroolDesignSystem_273eab;
  return /*#__PURE__*/React.createElement("div", {
    className: "sk-screen"
  }, /*#__PURE__*/React.createElement(SkBar, {
    title: "Notifications",
    actions: /*#__PURE__*/React.createElement(IconButton, {
      label: "Notification settings",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "settings",
      size: 19
    }))
  }), /*#__PURE__*/React.createElement("div", {
    className: "sk-scroll"
  }, /*#__PURE__*/React.createElement(Banner, {
    tone: "info",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "clock",
      size: 17
    }),
    title: "Batched"
  }, "Delivered three times a day. ", /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Change"), "."), /*#__PURE__*/React.createElement("ul", {
    className: "sk-notif"
  }, /*#__PURE__*/React.createElement(NotificationRow, {
    unread: true,
    time: "2h",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "message-circle",
      size: 18
    })
  }, /*#__PURE__*/React.createElement("strong", null, "9 people"), " replied to your post about the zine printer."), /*#__PURE__*/React.createElement(NotificationRow, {
    unread: true,
    time: "4h",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "repeat-2",
      size: 18
    })
  }, /*#__PURE__*/React.createElement("strong", null, "Amara Osei"), " and 45 others reposted you."), /*#__PURE__*/React.createElement(NotificationRow, {
    time: "1d",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "shield-check",
      size: 18
    })
  }, "Your appeal was reviewed. ", /*#__PURE__*/React.createElement("strong", null, "The limit was removed.")), /*#__PURE__*/React.createElement(NotificationRow, {
    time: "1d",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "users",
      size: 18
    })
  }, /*#__PURE__*/React.createElement("strong", null, "Sunday Kitchen"), " accepted your request to join."), /*#__PURE__*/React.createElement(NotificationRow, {
    time: "2d",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "user-round-x",
      size: 18
    })
  }, "You restricted an account. ", /*#__PURE__*/React.createElement("strong", null, "They were not told."))), /*#__PURE__*/React.createElement(StatePanel, {
    state: "empty",
    title: "That's everything",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 20
    })
  }, "Nothing else is waiting. We won't invent a reason to bring you back.")), /*#__PURE__*/React.createElement(SkDock, {
    current: "alerts"
  }));
}
function SeekerVideo() {
  const {
    Avatar,
    Button,
    Icon,
    IconButton
  } = window.WetDroolDesignSystem_273eab;
  return /*#__PURE__*/React.createElement("div", {
    className: "sk-screen"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sk-video"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sk-video__scrim"
  }), /*#__PURE__*/React.createElement("div", {
    className: "sk-video__rail"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Icon, {
    name: "heart",
    size: 26
  }), "2.4k"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Icon, {
    name: "message-circle",
    size: 26
  }), "118"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Icon, {
    name: "repeat-2",
    size: 26
  }), "64"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Icon, {
    name: "captions",
    size: 26
  }), "CC"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Icon, {
    name: "more-horizontal",
    size: 26
  }))), /*#__PURE__*/React.createElement("div", {
    className: "sk-video__body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sk-video__meta"
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: "Dae Ferreira",
    seed: "acct_5511",
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", null, "Dae Ferreira"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary"
  }, "Follow")), /*#__PURE__*/React.createElement("p", {
    className: "sk-video__cap"
  }, "Three minutes on how to write a submission to a committee. Captions on by default."), /*#__PURE__*/React.createElement("div", {
    className: "sk-video__meta",
    style: {
      fontSize: 12,
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "pause",
    size: 16
  }), "0:42 / 3:10 \xB7 Sound off"), /*#__PURE__*/React.createElement("div", {
    className: "sk-progress"
  }, /*#__PURE__*/React.createElement("span", null)))), /*#__PURE__*/React.createElement(SkDock, {
    current: "explore"
  }));
}
function SeekerKit() {
  const items = [{
    c: /*#__PURE__*/React.createElement(SeekerFeed, null),
    t: 'Home feed',
    d: 'Bottom dock with visible labels, compose FAB clear of the gesture bar, feed source tabs at the top.'
  }, {
    c: /*#__PURE__*/React.createElement(SeekerComposer, null),
    t: 'Composer + audience sheet',
    d: 'Audience is a visible, worded choice on a bottom sheet — never an icon, never a silent default.'
  }, {
    c: /*#__PURE__*/React.createElement(SeekerWallet, null),
    t: 'Wallet & confirmation',
    d: 'Permission review before connecting, then staged confirmation. Nothing claims to be done early.'
  }, {
    c: /*#__PURE__*/React.createElement(SeekerAlerts, null),
    t: 'Notifications',
    d: 'Batched by default, with private actions surfaced as their own rows.'
  }, {
    c: /*#__PURE__*/React.createElement(SeekerVideo, null),
    t: 'Vertical video',
    d: 'Captions on by default, sound off until asked, playback pausable, counts subordinate to the caption.'
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "sk-page"
  }, items.map(s => /*#__PURE__*/React.createElement("div", {
    className: "sk-item",
    key: s.t
  }, /*#__PURE__*/React.createElement(window.AndroidDevice, {
    dark: true,
    width: 412,
    height: 860
  }, s.c), /*#__PURE__*/React.createElement("div", {
    className: "sk-cap"
  }, /*#__PURE__*/React.createElement("b", null, s.t), /*#__PURE__*/React.createElement("span", null, s.d)))));
}
Object.assign(window, {
  SeekerKit,
  SeekerFeed,
  SeekerComposer,
  SeekerWallet,
  SeekerAlerts,
  SeekerVideo,
  SkBar,
  SkDock
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seeker/Screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/seeker/android-frame.jsx
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
// Copied omelette starter. Re-running copy_starter_component with this kind overwrites this file with the latest version (page content is unaffected).

/* BEGIN USAGE */
// Android.jsx — Simplified Android (Material 3) device frame
// Status bar + top app bar + content + gesture nav + keyboard.
// Based on Figma M3 spec. No dependencies, no image assets.
// Exports (to window): AndroidDevice, AndroidStatusBar, AndroidAppBar, AndroidListItem, AndroidNavBar, AndroidKeyboard
//
// Usage — wrap your screen content in <AndroidDevice> to get the bezel, status
// bar and gesture nav (props: title, large, keyboard, dark):
//
//   <AndroidDevice title="Inbox" large>
//     ...your screen content...
//   </AndroidDevice>
//   <AndroidDevice title="Compose" keyboard>…</AndroidDevice>
/* END USAGE */

const MD_C = {
  surface: '#f4fbf8',
  surfaceVariant: '#dae5e1',
  inverseOnSurface: '#ecf2ef',
  secondaryContainer: '#cde8e1',
  primaryFixedDim: '#83d5c6',
  onSurface: '#171d1b',
  onSurfaceVar: '#49454f',
  onPrimaryContainer: '#00201c',
  primary: '#006a60',
  frameBorder: 'rgba(116,119,117,0.5)'
};

// ─────────────────────────────────────────────────────────────
// Status bar (time left, wifi/cell/battery right)
// ─────────────────────────────────────────────────────────────
function AndroidStatusBar({
  dark = false
}) {
  const c = dark ? '#fff' : MD_C.onSurface;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 40,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      position: 'relative',
      fontFamily: 'Roboto, system-ui, sans-serif'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 128,
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 400,
      letterSpacing: 0.25,
      lineHeight: '20px',
      color: c
    }
  }, "9:30")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: '50%',
      top: 8,
      transform: 'translateX(-50%)',
      width: 24,
      height: 24,
      borderRadius: 100,
      background: '#2e2e2e'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      paddingRight: 2
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 16 16",
    style: {
      marginRight: -2
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M8 13.3L.67 5.97a10.37 10.37 0 0114.66 0L8 13.3z",
    fill: c
  })), /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 16 16",
    style: {
      marginRight: -2
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M14.67 14.67V1.33L1.33 14.67h13.34z",
    fill: c
  }))), /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 16 16"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "3.75",
    y: "2",
    width: "8.5",
    height: "13",
    rx: "1.5",
    fill: c
  }), /*#__PURE__*/React.createElement("rect", {
    x: "5.5",
    y: "0.9",
    width: "5",
    height: "2",
    rx: "0.5",
    fill: c
  }))));
}

// ─────────────────────────────────────────────────────────────
// Top app bar (Material 3 small/medium)
// ─────────────────────────────────────────────────────────────
function AndroidAppBar({
  title = 'Title',
  large = false
}) {
  const iconDot = /*#__PURE__*/React.createElement("div", {
    style: {
      width: 48,
      height: 48,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 22,
      height: 22,
      borderRadius: '50%',
      background: MD_C.onSurfaceVar,
      opacity: 0.3
    }
  }));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: MD_C.surface,
      padding: '4px 4px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 56,
      display: 'flex',
      alignItems: 'center',
      gap: 4
    }
  }, iconDot, !large && /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 22,
      fontWeight: 400,
      color: MD_C.onSurface,
      fontFamily: 'Roboto, system-ui, sans-serif'
    }
  }, title), large && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), iconDot), large && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 16px 20px',
      fontSize: 28,
      fontWeight: 400,
      color: MD_C.onSurface,
      fontFamily: 'Roboto, system-ui, sans-serif'
    }
  }, title));
}

// ─────────────────────────────────────────────────────────────
// List item (Material 3)
// ─────────────────────────────────────────────────────────────
function AndroidListItem({
  headline,
  supporting,
  leading
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '12px 16px',
      minHeight: 56,
      boxSizing: 'border-box',
      fontFamily: 'Roboto, system-ui, sans-serif'
    }
  }, leading && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 40,
      borderRadius: '50%',
      background: MD_C.primary,
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 18,
      fontWeight: 500,
      flexShrink: 0
    }
  }, leading), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 16,
      color: MD_C.onSurface,
      lineHeight: '24px'
    }
  }, headline), supporting && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: MD_C.onSurfaceVar,
      lineHeight: '20px'
    }
  }, supporting)));
}

// ─────────────────────────────────────────────────────────────
// Gesture nav bar (pill)
// ─────────────────────────────────────────────────────────────
function AndroidNavBar({
  dark = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 24,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 108,
      height: 4,
      borderRadius: 2,
      background: dark ? '#fff' : MD_C.onSurface,
      opacity: 0.4
    }
  }));
}

// ─────────────────────────────────────────────────────────────
// Device frame — wraps everything
// ─────────────────────────────────────────────────────────────
function AndroidDevice({
  children,
  width = 412,
  height = 892,
  dark = false,
  title,
  large = false,
  keyboard = false
}) {
  return (
    /*#__PURE__*/
    // data-om-starter: inert presence marker — Claude Design's starter-usage
    // probe reads it; it renders nothing. Keep it on this root element.
    React.createElement("div", {
      "data-om-starter": "android-frame",
      style: {
        width,
        height,
        borderRadius: 18,
        overflow: 'hidden',
        background: dark ? '#1d1b20' : MD_C.surface,
        border: `8px solid ${MD_C.frameBorder}`,
        boxShadow: '0 30px 80px rgba(0,0,0,0.25)',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box'
      }
    }, /*#__PURE__*/React.createElement(AndroidStatusBar, {
      dark: dark
    }), title !== undefined && /*#__PURE__*/React.createElement(AndroidAppBar, {
      title: title,
      large: large
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        overflow: 'auto'
      }
    }, children), keyboard && /*#__PURE__*/React.createElement(AndroidKeyboard, null), /*#__PURE__*/React.createElement(AndroidNavBar, {
      dark: dark
    }))
  );
}

// ─────────────────────────────────────────────────────────────
// Keyboard — Gboard (Material 3)
// ─────────────────────────────────────────────────────────────
function AndroidKeyboard() {
  let _k = 0;
  const key = (l, {
    flex = 1,
    bg = MD_C.surface,
    r = 6,
    minW,
    fs = 21
  } = {}) => /*#__PURE__*/React.createElement("div", {
    key: _k++,
    style: {
      height: 46,
      borderRadius: r,
      flex,
      minWidth: minW,
      background: bg,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Roboto, system-ui',
      fontSize: fs,
      color: MD_C.onPrimaryContainer
    }
  }, l);
  const row = (keys, style = {}) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      justifyContent: 'center',
      ...style
    }
  }, keys.map(l => key(l)));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: MD_C.inverseOnSurface,
      padding: '0 8px 8px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 44
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, row(['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p']), row(['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], {
    padding: '0 20px'
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, key('', {
    bg: MD_C.surfaceVariant
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flex: 7,
      minWidth: 274
    }
  }, ['z', 'x', 'c', 'v', 'b', 'n', 'm'].map(l => key(l))), key('', {
    bg: MD_C.surfaceVariant
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, key('?123', {
    bg: MD_C.secondaryContainer,
    r: 100,
    minW: 58,
    fs: 14
  }), key(',', {
    bg: MD_C.surfaceVariant
  }), key('', {
    flex: 3,
    minW: 154
  }), key('.', {
    bg: MD_C.surfaceVariant
  }), key('', {
    bg: MD_C.primaryFixedDim,
    r: 100,
    minW: 58
  }))));
}
Object.assign(window, {
  AndroidDevice,
  AndroidStatusBar,
  AndroidAppBar,
  AndroidListItem,
  AndroidNavBar,
  AndroidKeyboard
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seeker/android-frame.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/App.jsx
try { (() => {
function Aside({
  route
}) {
  const {
    ProviderHealthNotice,
    StatusBadge,
    Button,
    Chip,
    Icon
  } = window.WetDroolDesignSystem_273eab;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "wa-aside__card"
  }, /*#__PURE__*/React.createElement("h2", null, "Your feed, explained"), /*#__PURE__*/React.createElement("p", null, "You are seeing Following: people and communities you chose, newest first, with nothing inserted."), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "quiet"
  }, "Change feed preferences")), /*#__PURE__*/React.createElement(ProviderHealthNotice, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "radio-tower",
      size: 18
    }),
    name: "Community indexer (Berlin)",
    status: /*#__PURE__*/React.createElement(StatusBadge, {
      tone: "degraded"
    }, "Behind"),
    detail: "About 40 seconds behind.",
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "quiet"
    }, "Switch")
  }), /*#__PURE__*/React.createElement("div", {
    className: "wa-aside__card"
  }, /*#__PURE__*/React.createElement("h2", null, "Quiet right now"), /*#__PURE__*/React.createElement("ul", {
    className: "wa-aside__list"
  }, /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Sunday Kitchen"), /*#__PURE__*/React.createElement("span", null, "Rota for the 16th is up")), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Repair Caf\xE9s UK"), /*#__PURE__*/React.createElement("span", null, "3 new posts since Tuesday")), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("b", null, "Trans Tech Collective"), /*#__PURE__*/React.createElement("span", null, "Pinned: how to ask for accommodations")))), /*#__PURE__*/React.createElement("div", {
    className: "wa-aside__card"
  }, /*#__PURE__*/React.createElement("h2", null, "Nothing is trending"), /*#__PURE__*/React.createElement("p", null, "WetDrool does not rank conversations by how angry they are. There is no trending list.")));
}
function App() {
  const [route, setRoute] = React.useState('home');
  const [post, setPost] = React.useState(null);
  const open = p => {
    setPost(p);
    setRoute('post');
  };
  const screens = {
    home: /*#__PURE__*/React.createElement(window.HomeFeed, {
      onOpen: open
    }),
    explore: /*#__PURE__*/React.createElement(window.Explore, {
      onOpen: open
    }),
    post: /*#__PURE__*/React.createElement(window.PostDetail, {
      post: post,
      onBack: () => setRoute('home')
    }),
    profile: /*#__PURE__*/React.createElement(window.Profile, null),
    safety: /*#__PURE__*/React.createElement(window.Safety, null),
    settings: /*#__PURE__*/React.createElement(window.Settings, null)
  };
  return /*#__PURE__*/React.createElement(window.Shell, {
    route: route,
    setRoute: setRoute,
    aside: /*#__PURE__*/React.createElement(Aside, {
      route: route
    })
  }, screens[route]);
}
Object.assign(window, {
  App,
  Aside
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/Explore.jsx
try { (() => {
function Explore({
  onOpen
}) {
  const {
    SearchField,
    Chip,
    CommunityCard,
    Button,
    EventCard,
    SectionHeading,
    Icon,
    Banner
  } = window.WetDroolDesignSystem_273eab;
  const [picked, setPicked] = React.useState(['Mutual aid', 'Zine making']);
  const toggle = i => setPicked(p => p.includes(i) ? p.filter(x => x !== i) : [...p, i]);
  return /*#__PURE__*/React.createElement("div", {
    className: "wa-col"
  }, /*#__PURE__*/React.createElement(SearchField, {
    placeholder: "Search people, communities and posts"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 18
  })), /*#__PURE__*/React.createElement(SectionHeading, {
    size: "sm",
    as: "h1",
    eyebrow: "Explore",
    title: "Pick what you want more of.",
    description: /*#__PURE__*/React.createElement("p", null, "These choices only shape your feed. They are never used for advertising, and they are never inferred from what you read.")
  }), /*#__PURE__*/React.createElement("div", {
    className: "wa-chips"
  }, window.WS_DATA.interests.map(i => /*#__PURE__*/React.createElement(Chip, {
    key: i,
    selected: picked.includes(i),
    onClick: () => toggle(i),
    leadingIcon: picked.includes(i) ? /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 14
    }) : null
  }, i))), /*#__PURE__*/React.createElement(Banner, {
    tone: "info",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "info",
      size: 18
    }),
    title: "Why these?"
  }, "Communities below match the interests you picked and the languages you read. ", /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "See how this is decided"), "."), /*#__PURE__*/React.createElement("div", {
    className: "wa-grid2"
  }, window.WS_DATA.communities.map(c => /*#__PURE__*/React.createElement(CommunityCard, {
    key: c.name,
    name: c.name,
    members: c.members,
    description: c.desc,
    tags: c.tags.map(t => /*#__PURE__*/React.createElement(Chip, {
      key: t,
      interactive: false
    }, t)),
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "Join")
  }))), /*#__PURE__*/React.createElement("h2", {
    className: "wa-h2"
  }, "Happening near you"), /*#__PURE__*/React.createElement("div", {
    className: "wa-grid2"
  }, /*#__PURE__*/React.createElement(EventCard, {
    day: "14",
    month: "Mar",
    title: "Zine night at the community centre",
    meta: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", null, "7:00 PM GMT"), /*#__PURE__*/React.createElement("span", null, "Address shared after RSVP"), /*#__PURE__*/React.createElement("span", null, "Attendance private")),
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "secondary"
    }, "RSVP")
  }), /*#__PURE__*/React.createElement(EventCard, {
    day: "18",
    month: "Mar",
    title: "Captioning workshop \\u2014 bring a laptop",
    meta: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", null, "6:30 PM GMT"), /*#__PURE__*/React.createElement("span", null, "Hybrid \\u00B7 live captions"), /*#__PURE__*/React.createElement("span", null, "Free")),
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "secondary"
    }, "RSVP")
  })));
}
Object.assign(window, {
  Explore
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/Explore.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/HomeFeed.jsx
try { (() => {
function FeedPost({
  post,
  onOpen
}) {
  const {
    PostCard,
    ReactionBar,
    StatusBadge,
    IconButton,
    Icon
  } = window.WetDroolDesignSystem_273eab;
  const [revealed, setRevealed] = React.useState(false);
  const [liked, setLiked] = React.useState(false);
  return /*#__PURE__*/React.createElement(PostCard, {
    author: post.author,
    timestamp: post.time,
    contextLine: post.context ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Icon, {
      name: "sparkles",
      size: 13
    }), post.context) : null,
    verification: /*#__PURE__*/React.createElement(StatusBadge, {
      tone: post.verified
    }, post.verified === 'verified' ? 'Verified' : 'Waiting for confirmation'),
    contentWarning: post.cw,
    revealed: revealed,
    onReveal: () => setRevealed(true),
    body: post.body,
    media: post.media && (!post.cw || revealed) ? /*#__PURE__*/React.createElement("figure", {
      className: "wa-media"
    }, /*#__PURE__*/React.createElement("div", {
      className: "wa-media__frame"
    }, /*#__PURE__*/React.createElement("span", null, post.media.caption)), /*#__PURE__*/React.createElement("figcaption", null, /*#__PURE__*/React.createElement("span", {
      className: "wa-media__alt"
    }, "ALT"), " Alt text supplied by the author")) : null,
    actions: /*#__PURE__*/React.createElement(ReactionBar, {
      counts: {
        ...post.counts,
        likes: post.counts.likes + (liked ? 1 : 0)
      },
      state: {
        likes: liked
      },
      onAction: k => k === 'likes' ? setLiked(!liked) : onOpen(post),
      extra: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(IconButton, {
        label: "Share this post",
        inline: true
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "share-2",
        size: 18
      })), /*#__PURE__*/React.createElement(IconButton, {
        label: 'More options for ' + post.author.name,
        inline: true
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "more-horizontal",
        size: 18
      })))
    })
  });
}
function HomeFeed({
  onOpen
}) {
  const {
    ComposerBar,
    Tabs,
    Chip,
    Button,
    IconButton,
    Icon,
    Banner,
    StatePanel
  } = window.WetDroolDesignSystem_273eab;
  const [tab, setTab] = React.useState('following');
  const posts = window.WS_DATA.posts;
  return /*#__PURE__*/React.createElement("div", {
    className: "wa-col"
  }, /*#__PURE__*/React.createElement(ComposerBar, {
    author: window.WS_DATA.me,
    tools: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(IconButton, {
      label: "Add photo or video",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "image",
      size: 18
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Add a poll",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "chart-no-axes-column",
      size: 18
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Add a content warning",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "eye-off",
      size: 18
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Add alt text",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "type",
      size: 18
    }))),
    audience: /*#__PURE__*/React.createElement(Chip, {
      leadingIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "users",
        size: 14
      })
    }, "Followers"),
    submit: /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "Post"),
    status: /*#__PURE__*/React.createElement("p", {
      className: "wa-hint"
    }, "Draft saved on this device.")
  }), /*#__PURE__*/React.createElement(Tabs, {
    label: "Feed source",
    value: tab,
    onChange: setTab,
    items: [{
      value: 'following',
      label: 'Following'
    }, {
      value: 'latest',
      label: 'Latest'
    }, {
      value: 'communities',
      label: 'Communities'
    }, {
      value: 'quiet',
      label: 'Quiet mode'
    }]
  }), tab === 'quiet' ? /*#__PURE__*/React.createElement(StatePanel, {
    state: "empty",
    title: "Quiet mode is on",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "moon",
      size: 22
    }),
    actions: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm",
      onClick: () => setTab('following')
    }, "Back to Following")
  }, "Only posts from people you follow, no reposts, no counts, no recommendations. Nothing is hidden permanently \u2014 turn it off whenever you like.") : /*#__PURE__*/React.createElement(React.Fragment, null, tab === 'latest' ? /*#__PURE__*/React.createElement(Banner, {
    tone: "info",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "clock",
      size: 18
    }),
    title: "This feed is strictly in order"
  }, "Nothing is ranked, promoted or inserted. You may see gaps when your indexer is catching up.") : null, posts.map(p => /*#__PURE__*/React.createElement(FeedPost, {
    key: p.id,
    post: p,
    onOpen: onOpen
  }))));
}
Object.assign(window, {
  HomeFeed,
  FeedPost
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/HomeFeed.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/PostDetail.jsx
try { (() => {
function PostDetail({
  post,
  onBack
}) {
  const {
    PostCard,
    ReactionBar,
    StatusBadge,
    VerificationDetail,
    ComposerBar,
    Button,
    Chip,
    IconButton,
    Icon,
    Avatar
  } = window.WetDroolDesignSystem_273eab;
  const p = post || window.WS_DATA.posts[0];
  return /*#__PURE__*/React.createElement("div", {
    className: "wa-col"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wa-back",
    onClick: onBack
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-left",
    size: 18
  }), "Back to your feed"), /*#__PURE__*/React.createElement(PostCard, {
    lead: true,
    author: p.author,
    timestamp: p.time,
    verification: /*#__PURE__*/React.createElement(StatusBadge, {
      tone: "verified"
    }, "Verified"),
    body: p.body,
    actions: /*#__PURE__*/React.createElement(ReactionBar, {
      counts: p.counts,
      extra: /*#__PURE__*/React.createElement(IconButton, {
        label: "Share this post",
        inline: true
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "share-2",
        size: 18
      }))
    }),
    footer: /*#__PURE__*/React.createElement(VerificationDetail, {
      rows: [{
        label: 'Content hash',
        value: 'b3:9f2c8e41ad7b0c5e',
        mono: true
      }, {
        label: 'Manifest',
        value: 'ipfs://bafy…q4ta',
        mono: true
      }, {
        label: 'Signature',
        value: 'Valid'
      }, {
        label: 'Hash match',
        value: 'Valid'
      }, {
        label: 'DroolNet anchor',
        value: 'Slot 298,441,203 · finalized'
      }, {
        label: 'Indexed by',
        value: 'Community indexer (Berlin)'
      }],
      note: "This proves the post has not changed since it was signed, and that the signature belongs to this account. It does not prove the claims inside it."
    })
  }), /*#__PURE__*/React.createElement("h2", {
    className: "wa-h2"
  }, "4 replies"), /*#__PURE__*/React.createElement(ComposerBar, {
    author: window.WS_DATA.me,
    placeholder: "Reply to Ro\u2026",
    tools: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(IconButton, {
      label: "Add photo",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "image",
      size: 18
    })), /*#__PURE__*/React.createElement(IconButton, {
      label: "Add a content warning",
      inline: true
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "eye-off",
      size: 18
    }))),
    audience: /*#__PURE__*/React.createElement(Chip, {
      leadingIcon: /*#__PURE__*/React.createElement(Icon, {
        name: "message-circle",
        size: 14
      })
    }, "Anyone can reply"),
    submit: /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "Reply")
  }), /*#__PURE__*/React.createElement("ul", {
    className: "wa-thread"
  }, [{
    n: 'Amara Osei',
    h: 'amara',
    pr: 'she/her',
    t: '3h',
    b: 'Putting this in the community pinned post. What time do you open?'
  }, {
    n: 'Kit Alvarez',
    h: 'kit',
    pr: 'he/him',
    t: '2h',
    b: 'I have three reams of A4 nobody wants. Bringing them.'
  }, {
    n: 'Ro Mbeki',
    h: 'ro',
    pr: 'they/them',
    t: '2h',
    b: 'Six until nine. Kit you are a menace and I love you.'
  }].map(r => /*#__PURE__*/React.createElement("li", {
    key: r.h,
    className: "wa-reply"
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: r.n,
    seed: r.h,
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "wa-reply__meta"
  }, /*#__PURE__*/React.createElement("b", null, r.n), /*#__PURE__*/React.createElement("span", {
    className: "wa-pronoun"
  }, r.pr), /*#__PURE__*/React.createElement("span", null, "@", r.h, " \xB7 ", r.t)), /*#__PURE__*/React.createElement("p", {
    className: "wa-reply__body"
  }, r.b))))));
}
Object.assign(window, {
  PostDetail
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/PostDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/Profile.jsx
try { (() => {
function Profile() {
  const {
    Avatar,
    Button,
    Chip,
    Tabs,
    StatusBadge,
    Icon,
    IconButton
  } = window.WetDroolDesignSystem_273eab;
  const [tab, setTab] = React.useState('posts');
  const [following, setFollowing] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    className: "wa-col"
  }, /*#__PURE__*/React.createElement("section", {
    className: "wa-profile"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wa-profile__banner",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("div", {
    className: "wa-profile__head"
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: "Ro Mbeki",
    seed: "acct_8812",
    size: "xl",
    className: "wa-profile__avatar"
  }), /*#__PURE__*/React.createElement("div", {
    className: "wa-profile__actions"
  }, /*#__PURE__*/React.createElement(IconButton, {
    label: "More options for Ro Mbeki",
    variant: "outlined"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "more-horizontal",
    size: 19
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    leadingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "mail",
      size: 17
    })
  }, "Message"), /*#__PURE__*/React.createElement(Button, {
    variant: following ? 'secondary' : 'primary',
    onClick: () => setFollowing(!following)
  }, following ? 'Following' : 'Follow'))), /*#__PURE__*/React.createElement("div", {
    className: "wa-profile__id"
  }, /*#__PURE__*/React.createElement("h1", null, "Ro Mbeki"), /*#__PURE__*/React.createElement("div", {
    className: "wa-profile__meta"
  }, /*#__PURE__*/React.createElement("span", {
    className: "wa-pronoun"
  }, "they/them"), /*#__PURE__*/React.createElement("span", {
    className: "wa-pronoun"
  }, "iel"), /*#__PURE__*/React.createElement("span", null, "@ro"), /*#__PURE__*/React.createElement(StatusBadge, {
    tone: "verified"
  }, "Identity verified")), /*#__PURE__*/React.createElement("p", {
    className: "wa-profile__bio"
  }, "Printer wrangler at the community centre. Zines on Thursdays, repairs on Saturdays. Ask me about paper weights, I dare you."), /*#__PURE__*/React.createElement("div", {
    className: "wa-profile__facts"
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Icon, {
    name: "map-pin",
    size: 15
  }), "Manchester"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Icon, {
    name: "calendar",
    size: 15
  }), "Joined June 2025"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "1,204"), " followers"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", null, "318"), " following")))), /*#__PURE__*/React.createElement(Tabs, {
    label: "Profile sections",
    value: tab,
    onChange: setTab,
    items: [{
      value: 'posts',
      label: 'Posts'
    }, {
      value: 'replies',
      label: 'Replies'
    }, {
      value: 'media',
      label: 'Media'
    }, {
      value: 'communities',
      label: 'Communities'
    }]
  }), tab === 'communities' ? /*#__PURE__*/React.createElement("div", {
    className: "wa-chips"
  }, ['Trans Tech Collective', 'Sunday Kitchen', 'Repair Cafés UK'].map(c => /*#__PURE__*/React.createElement(Chip, {
    key: c,
    interactive: false,
    leadingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "users",
      size: 14
    })
  }, c))) : /*#__PURE__*/React.createElement(React.Fragment, null, window.WS_DATA.posts.slice(0, 2).map(p => /*#__PURE__*/React.createElement(window.FeedPost, {
    key: p.id,
    post: {
      ...p,
      author: window.WS_DATA.posts[0].author,
      context: null
    },
    onOpen: () => {}
  }))));
}
Object.assign(window, {
  Profile
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/Profile.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/Safety.jsx
try { (() => {
function Safety() {
  const {
    SectionHeading,
    Card,
    Button,
    Checkbox,
    Field,
    Banner,
    Dialog,
    Toast,
    StatusBadge,
    Icon,
    Chip
  } = window.WetDroolDesignSystem_273eab;
  const [step, setStep] = React.useState('centre');
  const [confirm, setConfirm] = React.useState(false);
  const [done, setDone] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    className: "wa-col"
  }, /*#__PURE__*/React.createElement(SectionHeading, {
    size: "sm",
    as: "h1",
    eyebrow: "Safety centre",
    title: "You decide who reaches you.",
    description: /*#__PURE__*/React.createElement("p", null, "Personal controls take effect immediately and privately. Community and service decisions are scoped, logged and appealable.")
  }), done ? /*#__PURE__*/React.createElement(Toast, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 16
    })
  }, "Restricted for 7 days. They were not told.") : null, step === 'centre' ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "wa-grid2"
  }, [{
    i: 'user-round-x',
    t: 'Block',
    d: "They can't see you, follow you, or message you. They aren't notified."
  }, {
    i: 'volume-x',
    t: 'Mute',
    d: "You stop seeing them. Nothing changes for them."
  }, {
    i: 'shield-half',
    t: 'Restrict',
    d: "Their replies are hidden from everyone but them. Quiet, reversible, and private."
  }, {
    i: 'flag',
    t: 'Report',
    d: 'Goes to the community moderators first, then to us if it is against our standards.'
  }].map(o => /*#__PURE__*/React.createElement(Card, {
    key: o.t,
    className: "wa-safety"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wa-safety__icon"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: o.i,
    size: 20
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", null, o.t), /*#__PURE__*/React.createElement("p", null, o.d)), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    onClick: () => setStep(o.t === 'Report' ? 'report' : 'restrict')
  }, o.t)))), /*#__PURE__*/React.createElement(Banner, {
    tone: "moderation",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "gavel",
      size: 18
    }),
    title: "One of your posts was limited on 12 March"
  }, "A moderator of Old Games Club limited it to members. It is still visible to you and to people who follow you. ", /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => {
      e.preventDefault();
      setStep('appeal');
    }
  }, "Read the decision or appeal"), ".")) : null, step === 'restrict' ? /*#__PURE__*/React.createElement(Card, {
    variant: "panel"
  }, /*#__PURE__*/React.createElement(SectionHeading, {
    size: "sm",
    as: "h2",
    title: "Restrict @riverkid?",
    description: /*#__PURE__*/React.createElement("p", null, "Their replies to you will be hidden from everyone except them. They are not told, and you can undo this at any time.")
  }), /*#__PURE__*/React.createElement("div", {
    className: "wa-stack"
  }, /*#__PURE__*/React.createElement(Checkbox, {
    type: "radio",
    name: "dur",
    label: "For 7 days",
    description: "Enough to let a pile-on pass.",
    defaultChecked: true
  }), /*#__PURE__*/React.createElement(Checkbox, {
    type: "radio",
    name: "dur",
    label: "For 30 days"
  }), /*#__PURE__*/React.createElement(Checkbox, {
    type: "radio",
    name: "dur",
    label: "Until I undo it"
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Also hide their existing replies",
    description: "You can restore them later from your safety log."
  })), /*#__PURE__*/React.createElement("div", {
    className: "wa-actions"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "quiet",
    onClick: () => setStep('centre')
  }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
    onClick: () => {
      setStep('centre');
      setDone(true);
    }
  }, "Restrict"))) : null, step === 'report' ? /*#__PURE__*/React.createElement(Card, {
    variant: "panel"
  }, /*#__PURE__*/React.createElement(SectionHeading, {
    size: "sm",
    as: "h2",
    title: "What happened?",
    description: /*#__PURE__*/React.createElement("p", null, "Pick the closest reason. You will not be asked to re-read the content, and the person is never told who reported them.")
  }), /*#__PURE__*/React.createElement("div", {
    className: "wa-stack"
  }, ['Targeted harassment', 'Hate speech or slurs', 'Threats or incitement', 'Deadnaming or outing someone', 'Spam or scams', 'Something else'].map((r, i) => /*#__PURE__*/React.createElement(Checkbox, {
    key: r,
    type: "radio",
    name: "reason",
    label: r,
    defaultChecked: i === 3
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Anything you want the moderators to know",
    as: "textarea",
    rows: 2,
    optional: true,
    help: "Optional. Nothing you write here is shown to the person you're reporting."
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Also block this account",
    description: "They lose all access to your posts and profile immediately."
  })), /*#__PURE__*/React.createElement("div", {
    className: "wa-actions"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "quiet",
    onClick: () => setStep('centre')
  }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    onClick: () => setConfirm(true)
  }, "Send report"))) : null, step === 'appeal' ? /*#__PURE__*/React.createElement(Card, {
    variant: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wa-actions",
    style: {
      justifyContent: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(StatusBadge, {
    tone: "moderation"
  }, "Decision \xB7 12 March"), /*#__PURE__*/React.createElement(Chip, {
    interactive: false
  }, "Old Games Club")), /*#__PURE__*/React.createElement(SectionHeading, {
    size: "sm",
    as: "h2",
    title: "Your post was limited to members.",
    description: /*#__PURE__*/React.createElement("p", null, "A moderator applied the community's rule on linking to storefronts. The post is still on your profile and still visible to your followers. It does not affect your account standing.")
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Why should this be reconsidered?",
    as: "textarea",
    rows: 3,
    help: "A person reviews every appeal. Most are answered within two days."
  }), /*#__PURE__*/React.createElement("div", {
    className: "wa-actions"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "quiet",
    onClick: () => setStep('centre')
  }, "Back"), /*#__PURE__*/React.createElement(Button, {
    onClick: () => setStep('centre')
  }, "Submit appeal"))) : null, /*#__PURE__*/React.createElement(Dialog, {
    open: confirm,
    title: "Send this report?",
    description: "It goes to the moderators of Old Games Club first. If it breaks WetDrool's standards it comes to us as well. You can withdraw it from your safety log at any time.",
    onDismiss: () => setConfirm(false),
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: () => setConfirm(false)
    }, "Not yet"), /*#__PURE__*/React.createElement(Button, {
      variant: "danger",
      onClick: () => {
        setConfirm(false);
        setStep('centre');
        setDone(true);
      }
    }, "Send report"))
  }));
}
Object.assign(window, {
  Safety
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/Safety.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/Settings.jsx
try { (() => {
function Settings() {
  const {
    SectionHeading,
    Card,
    Switch,
    Select,
    Field,
    Button,
    ProviderHealthNotice,
    StatusBadge,
    WalletConnectCard,
    Banner,
    Icon,
    Tabs
  } = window.WetDroolDesignSystem_273eab;
  const [tab, setTab] = React.useState('feed');
  return /*#__PURE__*/React.createElement("div", {
    className: "wa-col"
  }, /*#__PURE__*/React.createElement(SectionHeading, {
    size: "sm",
    as: "h1",
    eyebrow: "Settings",
    title: "Your account, your terms."
  }), /*#__PURE__*/React.createElement(Tabs, {
    label: "Settings sections",
    value: tab,
    onChange: setTab,
    items: [{
      value: 'feed',
      label: 'Feed preferences'
    }, {
      value: 'identity',
      label: 'Identity'
    }, {
      value: 'providers',
      label: 'Providers'
    }, {
      value: 'wallet',
      label: 'Wallet'
    }]
  }), tab === 'feed' ? /*#__PURE__*/React.createElement(Card, {
    variant: "panel",
    className: "wa-stack"
  }, /*#__PURE__*/React.createElement(Switch, {
    label: "Show me why a post was recommended",
    description: "Adds a one-line explanation above ranked posts.",
    defaultChecked: true
  }), /*#__PURE__*/React.createElement(Switch, {
    label: "Batch my notifications",
    description: "Delivered a few times a day instead of the moment they happen.",
    defaultChecked: true
  }), /*#__PURE__*/React.createElement(Switch, {
    label: "Hide reply and repost counts",
    description: "Replies still work. The numbers just stop shouting."
  }), /*#__PURE__*/React.createElement(Switch, {
    label: "Autoplay video",
    description: "Off means you tap to play. Sound is always off until you turn it on."
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Default feed when I open WetDrool",
    options: [{
      value: 'following',
      label: 'Following'
    }, {
      value: 'latest',
      label: 'Latest (strictly chronological)'
    }, {
      value: 'quiet',
      label: 'Quiet mode'
    }],
    help: "You can switch at any time from the top of the feed."
  })) : null, tab === 'identity' ? /*#__PURE__*/React.createElement(Card, {
    variant: "panel",
    className: "wa-stack"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Display name",
    defaultValue: "Ro Mbeki",
    help: "This is the only name shown anywhere on WetDrool. Changing it updates every past post immediately."
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Pronouns",
    defaultValue: "they/them",
    optional: true,
    help: "Add as many sets as you like. Each set has its own visibility."
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Handle",
    defaultValue: "ro",
    help: "People use this to find you. It is not your identity \u2014 you keep your account if you change it."
  }), /*#__PURE__*/React.createElement(Banner, {
    tone: "info",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "shield",
      size: 18
    }),
    title: "We never ask for a legal name"
  }, "Gender, sexuality and disability fields are optional, private by default, and excluded from recommendations and analytics."), /*#__PURE__*/React.createElement(Switch, {
    label: "Hide my previous display names",
    description: "Signed copies of old posts may still contain earlier names. We warn you before revealing any historical revision.",
    defaultChecked: true
  })) : null, tab === 'providers' ? /*#__PURE__*/React.createElement(Card, {
    variant: "panel",
    className: "wa-stack"
  }, /*#__PURE__*/React.createElement("p", {
    className: "wa-lede"
  }, "These services make WetDrool fast. None of them owns your account, and switching one never costs you your identity or your followers."), /*#__PURE__*/React.createElement(ProviderHealthNotice, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "radio-tower",
      size: 18
    }),
    name: "Community indexer (Berlin)",
    status: /*#__PURE__*/React.createElement(StatusBadge, {
      tone: "degraded"
    }, "Behind"),
    detail: "About 40 seconds behind. Newer posts may not be here yet.",
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "quiet"
    }, "Switch")
  }), /*#__PURE__*/React.createElement(ProviderHealthNotice, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "hard-drive",
      size: 18
    }),
    name: "Media gateway (default)",
    status: /*#__PURE__*/React.createElement(StatusBadge, {
      tone: "verified"
    }, "Healthy"),
    detail: "Serving images and video normally.",
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "quiet"
    }, "Switch")
  }), /*#__PURE__*/React.createElement(ProviderHealthNotice, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "antenna",
      size: 18
    }),
    name: "Message relay (default)",
    status: /*#__PURE__*/React.createElement(StatusBadge, {
      tone: "verified"
    }, "Healthy"),
    detail: "Encrypted messages are delivered end to end. The relay cannot read them.",
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "quiet"
    }, "Switch")
  }), /*#__PURE__*/React.createElement(Banner, {
    tone: "warning",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "triangle-alert",
      size: 18
    }),
    title: "One provider may keep permanent copies"
  }, "If you publish to a permanent store, nobody \u2014 including us \u2014 can delete those copies later. We ask you before every publication that uses one.")) : null, tab === 'wallet' ? /*#__PURE__*/React.createElement(WalletConnectCard, {
    title: "You have not connected a wallet.",
    description: "You don't need one. Everything you have done so far \u2014 posting, joining, messaging, moderating \u2014 works without it. A wallet is only required if you want to claim a portable handle.",
    permissions: [{
      title: 'Ask you to approve an action.',
      detail: 'Always with a plain-language summary first.',
      allowed: true
    }, {
      title: 'Move funds on its own.',
      allowed: false
    }, {
      title: 'Read your private messages.',
      allowed: false
    }, {
      title: 'Change your display name or pronouns.',
      allowed: false
    }],
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, null, "Review and connect"), /*#__PURE__*/React.createElement(Button, {
      variant: "quiet"
    }, "Not now")),
    footnote: "WetDrool never shows an address as your name, and never treats a balance as a reason to rank you higher."
  }) : null);
}
Object.assign(window, {
  Settings
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/Settings.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/Shell.jsx
try { (() => {
function Shell({
  route,
  setRoute,
  children,
  aside
}) {
  const {
    BrandMark,
    NavRail,
    SearchField,
    Button,
    Icon,
    ThemePicker
  } = window.WetDroolDesignSystem_273eab;
  const nav = [{
    value: 'home',
    label: 'Home',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "house",
      size: 21
    })
  }, {
    value: 'explore',
    label: 'Explore',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "compass",
      size: 21
    })
  }, {
    value: 'post',
    label: 'Notifications',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "bell",
      size: 21
    })
  }, {
    value: 'profile',
    label: 'Profile',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "user-round",
      size: 21
    })
  }, {
    value: 'safety',
    label: 'Safety',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "shield-check",
      size: 21
    })
  }, {
    value: 'settings',
    label: 'Settings',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "settings",
      size: 21
    })
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "wa-shell"
  }, /*#__PURE__*/React.createElement("header", {
    className: "wa-appbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wa-appbar__inner"
  }, /*#__PURE__*/React.createElement(BrandMark, {
    href: "#",
    assetBase: "../../assets/logo"
  }), /*#__PURE__*/React.createElement("div", {
    className: "wa-appbar__search"
  }, /*#__PURE__*/React.createElement(SearchField, {
    placeholder: "People, communities, posts"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 18
  }))), /*#__PURE__*/React.createElement("div", {
    className: "wa-appbar__actions"
  }, /*#__PURE__*/React.createElement(ThemePicker, {
    value: "dark"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "signal",
    size: "sm",
    leadingIcon: /*#__PURE__*/React.createElement(Icon, {
      name: "pen-line",
      size: 17
    }),
    onClick: () => setRoute('home')
  }, "Post")))), /*#__PURE__*/React.createElement("div", {
    className: "wa-body"
  }, /*#__PURE__*/React.createElement(NavRail, {
    labelled: true,
    current: route,
    label: "Primary",
    items: nav.map(n => ({
      ...n,
      href: '#'
    })),
    className: "wa-rail",
    onSelect: setRoute
  }), /*#__PURE__*/React.createElement("main", {
    className: "wa-main",
    id: "main"
  }, children), /*#__PURE__*/React.createElement("aside", {
    className: "wa-aside"
  }, aside)));
}
Object.assign(window, {
  Shell
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/Shell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/web-app/data.js
try { (() => {
/* Sample WetDrool content. Written, not generated — no lorem ipsum. */
window.WS_DATA = {
  me: {
    id: 'acct_me',
    name: 'You',
    handle: 'you'
  },
  posts: [{
    id: 'p1',
    author: {
      id: 'acct_8812',
      name: 'Ro Mbeki',
      handle: 'ro',
      pronouns: 'they/them'
    },
    time: '4h',
    verified: 'verified',
    body: "The zine printer at the community centre is fixed. Thursday sessions are back on \u2014 bring paper, bring nothing, bring a friend.",
    counts: {
      replies: 12,
      reposts: 4,
      likes: 88
    }
  }, {
    id: 'p2',
    author: {
      id: 'acct_2290',
      name: 'Amara Osei',
      handle: 'amara',
      pronouns: 'she/her'
    },
    time: '7h',
    verified: 'verified',
    context: 'Because you follow Disability Justice Now',
    body: "Our captioning fund covers any community event in the city, not just ours. If you're organising something and the quote scared you, message us before you cut the captions.",
    media: {
      caption: 'Photo \u2014 supplied by the organiser',
      alt: true
    },
    counts: {
      replies: 31,
      reposts: 46,
      likes: 204
    }
  }, {
    id: 'p3',
    author: {
      id: 'acct_5511',
      name: 'Dae Ferreira',
      handle: 'dae',
      pronouns: 'she/they'
    },
    time: '9h',
    verified: 'verified',
    cw: {
      label: 'Anti-trans legislation',
      detail: 'Discussion of a bill currently in committee, including quoted language from it.'
    },
    body: "The committee hearing is public and it is open to written submissions until Friday. I've put the template and the address in the community's pinned post.",
    counts: {
      replies: 8,
      reposts: 62,
      likes: 141
    }
  }, {
    id: 'p4',
    author: {
      id: 'acct_7013',
      name: 'Kit Alvarez',
      handle: 'kit',
      pronouns: 'he/him'
    },
    time: '11h',
    verified: 'pending',
    body: "Tried the chronological feed for a week. It's genuinely just the posts, in order, and I stopped checking twice an hour. Recommend.",
    counts: {
      replies: 3,
      reposts: 1,
      likes: 24
    }
  }],
  communities: [{
    name: 'Trans Tech Collective',
    members: '2,140 members \u00B7 moderated by 4 people',
    desc: 'Career, transition and tooling talk for trans people in tech. Read the pinned post before your first question.',
    tags: ['#tech', '#mutualaid']
  }, {
    name: 'Disability Justice Now',
    members: '8,930 members \u00B7 moderated by 11 people',
    desc: 'Organising, access needs, and a captioning fund that anyone in the city can draw on.',
    tags: ['#access', '#organising']
  }, {
    name: 'Sunday Kitchen',
    members: '612 members \u00B7 moderated by 3 people',
    desc: 'A rota, a shopping list, and whoever turns up. Food goes out Sundays at 2.',
    tags: ['#mutualaid', '#food']
  }, {
    name: 'Old Games Club',
    members: '4,406 members \u00B7 moderated by 6 people',
    desc: 'Pre-2005 games, emulation ethics, and a very long argument about save states.',
    tags: ['#games']
  }],
  interests: ['Trans joy', 'Mutual aid', 'Zine making', 'Disability justice', 'Local organising', 'Tabletop', 'Slow cooking', 'Field recording', 'Queer history', 'Repair cafés']
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/web-app/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Fab = __ds_scope.Fab;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.BrandMark = __ds_scope.BrandMark;

__ds_ns.Eyebrow = __ds_scope.Eyebrow;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.SectionHeading = __ds_scope.SectionHeading;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.Banner = __ds_scope.Banner;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.StatePanel = __ds_scope.StatePanel;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.SearchField = __ds_scope.SearchField;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.MobileDock = __ds_scope.MobileDock;

__ds_ns.NavRail = __ds_scope.NavRail;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.ThemePicker = __ds_scope.ThemePicker;

__ds_ns.CommunityCard = __ds_scope.CommunityCard;

__ds_ns.ComposerBar = __ds_scope.ComposerBar;

__ds_ns.EventCard = __ds_scope.EventCard;

__ds_ns.NotificationRow = __ds_scope.NotificationRow;

__ds_ns.PostCard = __ds_scope.PostCard;

__ds_ns.ReactionBar = __ds_scope.ReactionBar;

__ds_ns.ProviderHealthNotice = __ds_scope.ProviderHealthNotice;

__ds_ns.TransactionStatus = __ds_scope.TransactionStatus;

__ds_ns.VerificationDetail = __ds_scope.VerificationDetail;

__ds_ns.WalletConnectCard = __ds_scope.WalletConnectCard;

})();
