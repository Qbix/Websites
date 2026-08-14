(function (Q, $, window, undefined) {

var _layouts = null; // cached layouts.json

/**
 * Preview for Websites/section streams.
 * Reads layout from attributes, applies CSS grid,
 * pre-creates blocks on first render, supports layout switching.
 * Blocks edited by tapping (Streams/html or Streams/markdown).
 * @class Websites/section/preview
 * @constructor
 */
Q.Tool.define("Websites/section/preview", ["Streams/preview"],

function _Websites_section_preview(options, preview) {
    var tool = this;
    tool.preview = preview;
    preview.state.onRefresh.add(tool.refresh.bind(tool), tool);
    preview.state.onComposer.add(tool.composer.bind(tool), tool);
},

{
    layoutsUrl: '{{Websites}}/data/layouts.json',
    onRefresh: new Q.Event()
},

{
    refresh: function (stream, onLoad) {
        var tool = this;
        tool._stream = stream;
        tool._loadLayouts(function (layouts) {
            tool._render(stream, layouts, onLoad);
        });
    },

    _loadLayouts: function (callback) {
        if (_layouts) return callback(_layouts);
        Q.request(this.state.layoutsUrl, function (err, data) {
            _layouts = data || {};
            callback(_layouts);
        }, { skipNonce: true });
    },

    _render: function (stream, layouts, onLoad) {
        var tool = this;
        var ps = tool.preview.state;
        var editable = stream.testWriteLevel('edit');
        var attrs = stream.getAllAttributes();
        var layoutKey = attrs.layout || 'text-full';
        var layout = layouts[layoutKey] || layouts['text-full'] || {};
        var bg = attrs.background || '';
        var customPadding = attrs.padding || layout.padding || '60px 24px';
        var content = stream.fields.content || '';
        var title = stream.fields.title || '';
        var text = tool.text || {};
        var sectionsText = Q.getObject('Websites.sections', Q.text) || {};

        var container = document.createElement('div');
        container.className = 'Websites_section_preview'
            + (editable ? ' Websites_section_edit' : ' Websites_section_view');
        container.setAttribute('data-layout', layoutKey);
        if (bg) container.style.background = bg;
        container.style.padding = customPadding;

        if (layout.align) container.style.textAlign = layout.align;
        if (layout.maxWidth) {
            container.style.maxWidth = layout.maxWidth;
            container.style.marginLeft = 'auto';
            container.style.marginRight = 'auto';
        }
        if (layout.minHeight) container.style.minHeight = layout.minHeight;

        // Special layouts
        if (layout.separator) {
            container.innerHTML = '<hr class="Websites_section_divider">';
            tool.element.innerHTML = '';
            tool.element.appendChild(container);
            Q.handle(onLoad, tool);
            return;
        }
        if (layout.empty) {
            tool.element.innerHTML = '';
            tool.element.appendChild(container);
            Q.handle(onLoad, tool);
            return;
        }

        // ── Edit controls ──
        if (editable) {
            var controls = document.createElement('div');
            controls.className = 'Websites_section_controls';

            var dragHandle = document.createElement('span');
            dragHandle.className = 'Websites_section_drag';
            dragHandle.textContent = '⠿';
            controls.appendChild(dragHandle);

            // Layout change button via Q/actions
            var layoutBtn = document.createElement('button');
            layoutBtn.className = 'Websites_section_layout_btn';
            layoutBtn.textContent = (sectionsText.actions && sectionsText.actions.ChangeLayout) || 'Layout';
            layoutBtn.addEventListener(Q.Pointer.fastclick, function () {
                tool._showLayoutPicker(layouts, sectionsText);
            });
            controls.appendChild(layoutBtn);

            container.appendChild(controls);
        }

        // ── Section heading (if present or editable) ──
        if (editable && !layout.separator && !layout.empty) {
            var titleElement = Q.Tool.setUpElement('div', 'Streams/inplace', {
                publisherId: ps.publisherId,
                streamName: ps.streamName,
                field: 'title',
                inplaceType: 'text',
                editable: true,
                placeholder: (sectionsText.layouts && sectionsText.actions && sectionsText.actions.HeadingPlaceholder) || 'Section heading (optional)'
            }, null, tool.prefix);
            titleElement.classList.add('Websites_section_title');
            container.appendChild(titleElement);
        } else if (title) {
            var h = document.createElement('h3');
            h.className = 'Websites_section_view_title';
            h.textContent = title;
            container.appendChild(h);
        }

        // ── Section own content (optional preamble) ──
        if (content && !editable) {
            var contentElement = document.createElement('div');
            contentElement.className = 'Websites_section_view_content';
            var format = attrs.format || 'html';
            if (format === 'markdown' && window.marked) {
                contentElement.innerHTML = marked.parse(content);
            } else {
                contentElement.innerHTML = content;
            }
            container.appendChild(contentElement);
        } else if (editable && !layout.separator && !layout.empty) {
            var format = attrs.format || 'html';
            var editorTool = format === 'markdown' ? 'Streams/markdown' : 'Streams/html';
            var editorElement = Q.Tool.setUpElement('div', editorTool, {
                publisherId: ps.publisherId,
                streamName: ps.streamName,
                field: 'content',
                editable: true,
                placeholder: 'Section content (optional)...',
                livePreview: false
            }, null, tool.prefix);
            editorElement.classList.add('Websites_section_content_editor');
            container.appendChild(editorElement);
        }

        // ── Blocks grid ──
        var gridContainer = document.createElement('div');
        gridContainer.className = 'Websites_section_grid';

        // Apply grid CSS from layout
        if (layout.gridTemplate) {
            gridContainer.style.gridTemplateAreas = layout.gridTemplate;
            if (layout.gridTemplateColumns) {
                gridContainer.style.gridTemplateColumns = layout.gridTemplateColumns;
            }
        } else if (layout.grid) {
            gridContainer.style.gridTemplateColumns = layout.grid;
        }
        if (layout.gap) gridContainer.style.gap = layout.gap;
        if (layout.verticalAlign) gridContainer.style.alignItems = layout.verticalAlign;

        // Responsive data attributes for CSS media queries
        if (layout.gridTablet) gridContainer.setAttribute('data-grid-tablet', layout.gridTablet);
        if (layout.gridMobile) gridContainer.setAttribute('data-grid-mobile', layout.gridMobile);

        // Render blocks via Streams/related
        var blocksElement = Q.Tool.setUpElement('div', 'Streams/related', {
            publisherId: ps.publisherId,
            streamName: ps.streamName,
            relationType: 'Websites/blocks',
            isCategory: true,
            editable: editable,
            closeable: editable,
            sortable: editable,
            realtime: true,
            creatable: editable ? {
                'Websites/block': {
                    title: (sectionsText.roles && sectionsText.roles.block) || 'Add Block'
                }
            } : false
        }, null, tool.prefix);
        gridContainer.appendChild(blocksElement);
        container.appendChild(gridContainer);

        // Subgrid (for layouts like features-heading-3 that have a heading + grid below)
        if (layout.subgrid) {
            var subContainer = document.createElement('div');
            subContainer.className = 'Websites_section_subgrid';
            if (layout.subgrid.grid) subContainer.style.gridTemplateColumns = layout.subgrid.grid;
            if (layout.subgrid.gap) subContainer.style.gap = layout.subgrid.gap;
            if (layout.subgrid.gridTablet) subContainer.setAttribute('data-grid-tablet', layout.subgrid.gridTablet);
            if (layout.subgrid.gridMobile) subContainer.setAttribute('data-grid-mobile', layout.subgrid.gridMobile);
            gridContainer.appendChild(subContainer);
        }

        Q.Tool.clear(tool.element);
        tool.element.innerHTML = '';
        tool.element.appendChild(container);
        Q.activate(tool.element, function () {
            // Pre-create blocks if none exist yet
            if (editable && layout.blocks && layout.blocks.length) {
                tool._ensureBlocks(stream, layout);
            }
            Q.handle(tool.state.onRefresh, tool, [stream]);
            Q.handle(onLoad, tool);
        });
    },

    _ensureBlocks: function (stream, layout) {
        var tool = this;
        var ps = tool.preview.state;
        // Check if blocks already exist
        Q.Streams.related(ps.publisherId, ps.streamName, 'Websites/blocks', true, {
            limit: 1
        }, function () {
            if (this.relatedStreams && Object.keys(this.relatedStreams).length > 0) {
                return; // blocks already exist
            }
            // Pre-create blocks based on layout
            layout.blocks.forEach(function (blockDef, i) {
                Q.Streams.create({
                    publisherId: ps.publisherId,
                    type: 'Websites/block',
                    title: '',
                    content: '',
                    attributes: { role: blockDef.role, format: 'html', span: blockDef.span || 1 },
                    relate: {
                        publisherId: ps.publisherId,
                        streamName: ps.streamName,
                        type: 'Websites/blocks',
                        weight: (i + 1) * 1000
                    },
                    inheritAccess: JSON.stringify([[ps.publisherId, ps.streamName]])
                });
            });
        });
    },

    _showLayoutPicker: function (layouts, sectionsText) {
        var tool = this;
        var categories = layouts._categories || {};
        var catNames = (sectionsText.categories) || {};
        var layoutNames = (sectionsText.layouts) || {};

        // Build picker HTML grouped by category
        var html = '<div class="Websites_layout_picker">';
        var catOrder = Object.keys(categories).sort(function (a, b) {
            return (categories[a].order || 99) - (categories[b].order || 99);
        });

        catOrder.forEach(function (cat) {
            var catLayouts = Object.keys(layouts).filter(function (k) {
                return k !== '_categories' && layouts[k].category === cat;
            });
            if (!catLayouts.length) return;

            html += '<div class="Websites_lp_cat">';
            html += '<h4 class="Websites_lp_cat_title">' + (catNames[cat] || cat) + '</h4>';
            html += '<div class="Websites_lp_cat_grid">';
            catLayouts.forEach(function (key) {
                var l = layouts[key];
                var blockCount = (l.blocks || []).length;
                var cols = (l.grid || '1fr').split(' ').length;
                html += '<button class="Websites_lp_option" data-layout="' + key + '">'
                    + '<div class="Websites_lp_thumb" data-cols="' + cols + '" data-blocks="' + blockCount + '">';
                for (var i = 0; i < Math.min(blockCount, 6); i++) {
                    html += '<span></span>';
                }
                html += '</div>'
                    + '<span class="Websites_lp_name">' + (layoutNames[key] || key) + '</span>'
                    + '</button>';
            });
            html += '</div></div>';
        });
        html += '</div>';

        Q.Dialogs.push({
            title: (sectionsText.actions && sectionsText.actions.PickLayout) || 'Pick a layout',
            content: html,
            className: 'Websites_layout_picker_dialog',
            onActivate: function (dialog) {
                $(dialog).find('.Websites_lp_option').on(Q.Pointer.fastclick, function () {
                    var newLayout = $(this).data('layout');
                    var stream = tool._stream;
                    if (stream && newLayout) {
                        stream.setAttribute('layout', newLayout);
                        stream.save(function () {
                            tool.refresh.call(tool, stream);
                        });
                    }
                    Q.Dialogs.pop();
                });
            }
        });
    },

    composer: function () {
        var tool = this;
        var ps = tool.preview.state;
        var sectionsText = Q.getObject('Websites.sections', Q.text) || {};

        ps.creatable.preprocess = function (proceed) {
            // Show layout picker directly as the composer
            tool._loadLayouts(function (layouts) {
                tool._showLayoutPickerForCreate(layouts, sectionsText, proceed);
            });
        };
        return false;
    },

    _showLayoutPickerForCreate: function (layouts, sectionsText, proceed) {
        var categories = layouts._categories || {};
        var catNames = (sectionsText.categories) || {};
        var layoutNames = (sectionsText.layouts) || {};

        var html = '<div class="Websites_layout_picker">';
        var catOrder = Object.keys(categories).sort(function (a, b) {
            return (categories[a].order || 99) - (categories[b].order || 99);
        });

        catOrder.forEach(function (cat) {
            var catLayouts = Object.keys(layouts).filter(function (k) {
                return k !== '_categories' && layouts[k].category === cat;
            });
            if (!catLayouts.length) return;

            html += '<div class="Websites_lp_cat">';
            html += '<h4 class="Websites_lp_cat_title">' + (catNames[cat] || cat) + '</h4>';
            html += '<div class="Websites_lp_cat_grid">';
            catLayouts.forEach(function (key) {
                var l = layouts[key];
                var blockCount = (l.blocks || []).length;
                var cols = (l.grid || '1fr').split(' ').length;
                html += '<button class="Websites_lp_option" data-layout="' + key + '">'
                    + '<div class="Websites_lp_thumb" data-cols="' + cols + '" data-blocks="' + blockCount + '">';
                for (var i = 0; i < Math.min(blockCount, 6); i++) {
                    html += '<span></span>';
                }
                html += '</div>'
                    + '<span class="Websites_lp_name">' + (layoutNames[key] || key) + '</span>'
                    + '</button>';
            });
            html += '</div></div>';
        });
        html += '</div>';

        Q.Dialogs.push({
            title: (sectionsText.actions && sectionsText.actions.AddSection) || 'Add Section',
            content: html,
            className: 'Websites_layout_picker_dialog',
            onActivate: function (dialog) {
                $(dialog).find('.Websites_lp_option').on(Q.Pointer.fastclick, function () {
                    var layoutKey = $(this).data('layout');
                    Q.Dialogs.pop();
                    proceed({
                        title: '',
                        content: '',
                        attributes: JSON.stringify({
                            layout: layoutKey,
                            format: 'html'
                        })
                    });
                });
            }
        });
    }
});

})(Q, Q.jQuery, window);
