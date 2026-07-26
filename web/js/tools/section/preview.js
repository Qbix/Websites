(function (Q, $, window, undefined) {

/**
 * Preview for Websites/section streams — full-width content bands.
 * View mode: renders HTML or Markdown content.
 * Edit mode: Streams/inplace for heading, Streams/html for content,
 *   layout selector, background/padding controls.
 * Contains Websites/blocks as children via Streams/related.
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
    onRefresh: new Q.Event()
},

{
    refresh: function (stream, onLoad) {
        var tool = this;
        var ps = tool.preview.state;
        var editable = stream.testWriteLevel('edit');
        var content = stream.fields.content || '';
        var title = stream.fields.title || '';
        var attrs = stream.getAllAttributes();
        var format = attrs.format || 'html';
        var layout = attrs.layout || 'full';
        var bg = attrs.background || '';
        var padding = attrs.padding || '';

        var container = document.createElement('div');
        container.className = 'Websites_section_preview'
            + (editable ? ' Websites_section_edit' : ' Websites_section_view')
            + ' Websites_section_layout_' + layout;
        if (bg) container.style.background = bg;
        if (padding) container.style.padding = padding;

        if (editable) {
            // Drag handle
            var drag = document.createElement('span');
            drag.className = 'Websites_section_drag';
            drag.title = 'Drag to reorder';
            drag.textContent = '⠿';
            container.appendChild(drag);

            var body = document.createElement('div');
            body.className = 'Websites_section_body';

            // Title via Streams/inplace
            var titleEl = Q.Tool.setUpElement('div', 'Streams/inplace', {
                publisherId: ps.publisherId,
                streamName: ps.streamName,
                field: 'title',
                inplaceType: 'text',
                editable: true,
                placeholder: tool.text.section.HeadingPlaceholder || 'Section heading (optional)'
            }, null, tool.prefix);
            titleEl.className = 'Websites_section_title';
            body.appendChild(titleEl);

            // Content via Streams/html
            var contentEl = Q.Tool.setUpElement('div', 'Streams/html', {
                publisherId: ps.publisherId,
                streamName: ps.streamName,
                field: 'content',
                placeholder: tool.text.section.ContentPlaceholder || 'Section content...',
                editor: 'froala',
                froala: {
                    toolbarInline: true,
                    charCounterCount: false,
                    toolbarButtons: [
                        'bold', 'italic', 'underline', 'strikeThrough',
                        '|', 'formatOL', 'formatUL',
                        '|', 'paragraphFormat', 'insertLink',
                        'insertImage', '|', 'clearFormatting'
                    ],
                    heightMin: 40
                }
            }, null, tool.prefix);
            contentEl.className = 'Websites_section_content';
            body.appendChild(contentEl);

            // Blocks (children) via Streams/related
            var blocksEl = Q.Tool.setUpElement('div', 'Streams/related', {
                publisherId: ps.publisherId,
                streamName: ps.streamName,
                relationType: 'Websites/blocks',
                isCategory: true,
                editable: true,
                closeable: true,
                sortable: true,
                realtime: true,
                creatable: {
                    'Websites/block': {
                        title: tool.text.block.Add || 'Add Block'
                    }
                }
            }, null, tool.prefix);
            blocksEl.className = 'Websites_section_blocks';
            body.appendChild(blocksEl);

            container.appendChild(body);
        } else {
            // View mode
            if (title) {
                var h = document.createElement('h3');
                h.className = 'Websites_section_view_title';
                h.textContent = title;
                container.appendChild(h);
            }

            if (content) {
                var div = document.createElement('div');
                div.className = 'Websites_section_view_content';
                if (format === 'markdown' && window.marked) {
                    div.innerHTML = marked.parse(content);
                } else {
                    div.innerHTML = content;
                }
                container.appendChild(div);
            }

            // Render blocks (read-only)
            var blocksEl = Q.Tool.setUpElement('div', 'Streams/related', {
                publisherId: ps.publisherId,
                streamName: ps.streamName,
                relationType: 'Websites/blocks',
                isCategory: true,
                editable: false,
                sortable: false,
                realtime: false
            }, null, tool.prefix);
            blocksEl.className = 'Websites_section_blocks Websites_section_blocks_' + layout;
            container.appendChild(blocksEl);
        }

        Q.Tool.clear(tool.element);
        tool.element.innerHTML = '';
        tool.element.appendChild(container);
        Q.activate(tool.element, function () {
            Q.handle(tool.state.onRefresh, tool, [stream]);
            Q.handle(onLoad, tool);
        });
    },

    composer: function () {
        var tool = this;
        var ps = tool.preview.state;
        var text = tool.text.section || {};

        ps.creatable.preprocess = function (proceed) {
            Q.Dialogs.push({
                title: text.Add || 'Add Section',
                className: 'Websites_section_composer_dialog',
                content: '<div class="Websites_section_composer">'
                    + '<label>' + (text.Heading || 'Heading') + '</label>'
                    + '<input type="text" class="Websites_sc_heading" '
                    + 'placeholder="' + (text.HeadingPlaceholder || 'Section heading (optional)') + '" />'
                    + '<label>' + (text.Layout || 'Layout') + '</label>'
                    + '<select class="Websites_sc_layout">'
                    + '<option value="full">Full width</option>'
                    + '<option value="two-col">Two columns</option>'
                    + '<option value="three-col">Three columns</option>'
                    + '<option value="sidebar-left">Sidebar left</option>'
                    + '<option value="sidebar-right">Sidebar right</option>'
                    + '</select>'
                    + '<label>' + (text.Content || 'Content') + '</label>'
                    + '<textarea class="Websites_sc_text" rows="3" '
                    + 'placeholder="' + (text.ContentPlaceholder || 'Write content here...') + '"></textarea>'
                    + '<button class="Q_button Websites_sc_submit">'
                    + (text.Add || 'Add Section') + '</button>'
                    + '</div>',
                onActivate: function (dialog) {
                    $(dialog).find('.Websites_sc_submit').on(Q.Pointer.fastclick, function () {
                        var heading = $(dialog).find('.Websites_sc_heading').val().trim();
                        var layout = $(dialog).find('.Websites_sc_layout').val();
                        var content = $(dialog).find('.Websites_sc_text').val().trim();
                        Q.Dialogs.pop();
                        proceed({
                            title: heading,
                            content: content ? '<p>' + content.replace(/\n/g, '</p><p>') + '</p>' : '',
                            attributes: JSON.stringify({
                                layout: layout,
                                format: 'html'
                            })
                        });
                    });
                }
            });
        };
        return false;
    }
});

})(Q, Q.jQuery, window);