(function (Q, $, window, undefined) {

/**
 * Theme customization tool for Websites/page or any themed stream.
 * Shows current theme values (from auto-extraction or defaults),
 * lets admins override colors and fonts, saves to stream attributes.
 * Changes preview live via CSS variable updates.
 * @class Websites/theme
 * @constructor
 * @param {Object} [options]
 *   @param {String} options.publisherId
 *   @param {String} options.streamName
 *   @param {String} [options.attribute="theme"] Stream attribute to store overrides
 *   @param {Boolean} [options.showFonts=true] Whether to show font controls
 *   @param {Boolean} [options.showAdvanced=false] Start with advanced section open
 *   @param {Q.Event} [options.onSave] Fires after theme is saved
 */
Q.Tool.define("Websites/theme",

function _Websites_theme(options) {
    var tool = this;
    var state = tool.state;

    if (!state.publisherId || !state.streamName) {
        throw new Q.Error("Websites/theme: publisherId and streamName are required");
    }

    Q.Streams.get(state.publisherId, state.streamName, function () {
        tool._stream = this;
        tool.refresh();
    });
},

{
    publisherId: null,
    streamName: null,
    attribute: 'theme',
    showFonts: true,
    showAdvanced: false,
    colors: [
        { key: 'brand',     label: 'Brand Color' },
        { key: 'bg',        label: 'Background' },
        { key: 'fg',        label: 'Text' },
        { key: 'accent-1',  label: 'Accent' },
        { key: 'nav-bg',    label: 'Nav Background' },
        { key: 'nav-fg',    label: 'Nav Text' }
    ],
    fonts: [
        { key: 'font-body',    label: 'Body Font' },
        { key: 'font-heading', label: 'Heading Font' }
    ],
    fontOptions: [
        'System Default',
        'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
        'Poppins', 'Raleway', 'Nunito', 'Work Sans', 'DM Sans',
        'Playfair Display', 'Merriweather', 'Lora', 'Source Serif Pro',
        'Space Grotesk', 'JetBrains Mono', 'Fira Code'
    ],
    advanced: [
        { key: 'button-radius',       label: 'Button Radius', type: 'text', placeholder: '8px' },
        { key: 'card-radius',         label: 'Card Radius', type: 'text', placeholder: '12px' },
        { key: 'font-weight-heading', label: 'Heading Weight', type: 'select',
          options: ['400', '500', '600', '700', '800'] }
    ],
    onSave: new Q.Event()
},

{
    refresh: function () {
        var tool = this;
        var state = tool.state;
        var stream = tool._stream;
        if (!stream) return;

        var editable = stream.testWriteLevel('suggest');
        if (!editable) {
            tool.element.style.display = 'none';
            return;
        }

        var overrides = stream.getAttribute(state.attribute) || {};
        var text = tool.text || {};
        var themeText = text.theme || {};

        var html = '<div class="Websites_theme_editor">';

        // ── Color controls ──
        html += '<div class="Websites_theme_group">';
        html += '<h4 class="Websites_theme_group_title">'
            + (themeText.Colors || 'Colors') + '</h4>';

        state.colors.forEach(function (c) {
            var current = overrides[c.key] || tool._getCSSVar('theme-' + c.key) || '';
            html += '<div class="Websites_theme_row">'
                + '<label class="Websites_theme_label">' + c.label + '</label>'
                + '<div class="Websites_theme_control">'
                + '<input type="color" class="Websites_theme_color" '
                + 'data-key="' + c.key + '" '
                + 'value="' + (tool._toHex(current) || '#888888') + '" />'
                + '<input type="text" class="Websites_theme_color_text" '
                + 'data-key="' + c.key + '" '
                + 'value="' + current + '" '
                + 'placeholder="auto" />'
                + '<button class="Websites_theme_reset" data-key="' + c.key + '" '
                + 'title="' + (themeText.Reset || 'Reset to auto') + '">↺</button>'
                + '</div></div>';
        });
        html += '</div>';

        // ── Font controls ──
        if (state.showFonts) {
            html += '<div class="Websites_theme_group">';
            html += '<h4 class="Websites_theme_group_title">'
                + (themeText.Fonts || 'Fonts') + '</h4>';

            state.fonts.forEach(function (f) {
                var current = overrides[f.key] || '';
                html += '<div class="Websites_theme_row">'
                    + '<label class="Websites_theme_label">' + f.label + '</label>'
                    + '<select class="Websites_theme_font" data-key="' + f.key + '">'
                    + '<option value="">' + (themeText.Auto || 'Auto (from website)') + '</option>';
                state.fontOptions.forEach(function (font) {
                    var selected = (current === font) ? ' selected' : '';
                    html += '<option value="' + font + '"' + selected
                        + ' style="font-family:\'' + font + '\'">'
                        + font + '</option>';
                });
                html += '</select></div>';
            });
            html += '</div>';
        }

        // ── Advanced ──
        html += '<details class="Websites_theme_group Websites_theme_advanced"'
            + (state.showAdvanced ? ' open' : '') + '>';
        html += '<summary class="Websites_theme_group_title">'
            + (themeText.Advanced || 'Advanced') + '</summary>';

        state.advanced.forEach(function (a) {
            var current = overrides[a.key] || '';
            html += '<div class="Websites_theme_row">'
                + '<label class="Websites_theme_label">' + a.label + '</label>';
            if (a.type === 'select') {
                html += '<select class="Websites_theme_input" data-key="' + a.key + '">'
                    + '<option value="">Auto</option>';
                a.options.forEach(function (opt) {
                    html += '<option value="' + opt + '"'
                        + (current === opt ? ' selected' : '') + '>'
                        + opt + '</option>';
                });
                html += '</select>';
            } else {
                html += '<input type="text" class="Websites_theme_input" '
                    + 'data-key="' + a.key + '" '
                    + 'value="' + current + '" '
                    + 'placeholder="' + (a.placeholder || 'auto') + '" />';
            }
            html += '</div>';
        });
        html += '</details>';

        html += '</div>';

        tool.element.innerHTML = html;

        // ── Wire up live preview + save ──
        var $el = $(tool.element);
        var saveTimeout = null;

        function scheduleThemeSave() {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(function () {
                tool._saveTheme();
            }, 800);
        }

        // Color pickers
        $el.find('.Websites_theme_color').on('input', function () {
            var key = this.getAttribute('data-key');
            var val = this.value;
            $el.find('.Websites_theme_color_text[data-key="' + key + '"]').val(val);
            document.documentElement.style.setProperty('--theme-' + key, val);
            scheduleThemeSave();
        });

        // Color text inputs
        $el.find('.Websites_theme_color_text').on('change', function () {
            var key = this.getAttribute('data-key');
            var val = this.value.trim();
            if (val) {
                var hex = tool._toHex(val);
                if (hex) {
                    $el.find('.Websites_theme_color[data-key="' + key + '"]').val(hex);
                }
                document.documentElement.style.setProperty('--theme-' + key, val);
            }
            scheduleThemeSave();
        });

        // Reset buttons
        $el.find('.Websites_theme_reset').on(Q.Pointer.fastclick, function () {
            var key = this.getAttribute('data-key');
            $el.find('.Websites_theme_color_text[data-key="' + key + '"]').val('');
            document.documentElement.style.removeProperty('--theme-' + key);
            scheduleThemeSave();
        });

        // Font selects
        $el.find('.Websites_theme_font').on('change', function () {
            var key = this.getAttribute('data-key');
            var val = this.value;
            if (val && val !== 'System Default') {
                document.documentElement.style.setProperty('--' + key, "'" + val + "', sans-serif");
                // Load Google Font dynamically
                tool._loadFont(val);
            } else {
                document.documentElement.style.removeProperty('--' + key);
            }
            scheduleThemeSave();
        });

        // Advanced inputs
        $el.find('.Websites_theme_input').on('change', function () {
            var key = this.getAttribute('data-key');
            var val = this.value.trim();
            if (val) {
                document.documentElement.style.setProperty('--theme-' + key, val);
            } else {
                document.documentElement.style.removeProperty('--theme-' + key);
            }
            scheduleThemeSave();
        });
    },

    _saveTheme: function () {
        var tool = this;
        var state = tool.state;
        var stream = tool._stream;
        if (!stream) return;

        var overrides = {};
        var $el = $(tool.element);

        // Collect colors
        $el.find('.Websites_theme_color_text').each(function () {
            var val = this.value.trim();
            if (val) overrides[this.getAttribute('data-key')] = val;
        });

        // Collect fonts
        $el.find('.Websites_theme_font').each(function () {
            var val = this.value;
            if (val) overrides[this.getAttribute('data-key')] = val;
        });

        // Collect advanced
        $el.find('.Websites_theme_input').each(function () {
            var val = this.value.trim();
            if (val) overrides[this.getAttribute('data-key')] = val;
        });

        stream.setAttribute(state.attribute, overrides);
        stream.save(function () {
            Q.handle(state.onSave, tool, [overrides]);
        });
    },

    _getCSSVar: function (name) {
        return getComputedStyle(document.documentElement)
            .getPropertyValue('--' + name).trim();
    },

    _toHex: function (color) {
        if (!color) return '';
        if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
        // Try to parse via canvas
        try {
            var ctx = document.createElement('canvas').getContext('2d');
            ctx.fillStyle = color;
            return ctx.fillStyle; // returns #rrggbb
        } catch (e) {
            return '';
        }
    },

    _loadFont: function (fontName) {
        if (!fontName || fontName === 'System Default') return;
        var id = 'Websites_font_' + fontName.replace(/\s+/g, '_');
        if (document.getElementById(id)) return;
        var link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family='
            + encodeURIComponent(fontName)
            + ':wght@400;500;600;700&display=swap';
        document.head.appendChild(link);
    },

    Q: {
        beforeRemove: function () {
            this._stream = null;
        }
    }
});

})(Q, Q.jQuery, window);
