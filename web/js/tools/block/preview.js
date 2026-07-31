(function (Q, $, window, undefined) {

/**
 * Preview for Websites/block streams.
 * Each block has attributes.tool specifying which tool renders its content.
 * Tapping a block opens inline editing. A tool selector lets admins switch
 * the content type (html, markdown, image, etc).
 * Stream.content holds the actual content (max ~4000 chars).
 * @class Websites/block/preview
 * @constructor
 */
Q.Tool.define("Websites/block/preview", ["Streams/preview"],

function _Websites_block_preview(options, preview) {
    var tool = this;
    tool.preview = preview;
    preview.state.onRefresh.add(tool.refresh.bind(tool), tool);
    preview.state.onComposer.add(tool.composer.bind(tool), tool);
},

{
    // Whitelist of tools allowed in blocks
    allowedTools: null, // null = read from Q.Websites.block.tools config
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
        var blockTool = attrs.tool || 'Streams/html';
        var role = attrs.role || 'text';
        var area = attrs.area || null;
        var text = Q.getObject('Websites.sections', Q.text) || {};

        var allowedTools = tool.state.allowedTools
            || Q.getObject('Websites.block.tools', Q) || [
                'Streams/html', 'Streams/markdown',
                'Streams/image/preview', 'Streams/inplace'
            ];

        var container = document.createElement('div');
        container.className = 'Websites_block_preview Websites_block_role_' + role
            + (editable ? ' Websites_block_edit' : ' Websites_block_view');
        if (area) container.style.gridArea = area;

        if (editable) {
            var controls = document.createElement('div');
            controls.className = 'Websites_block_controls';

            // Tool selector
            var selector = document.createElement('select');
            selector.className = 'Websites_block_tool_select';
            selector.title = 'Content type';
            allowedTools.forEach(function (t) {
                var opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t.split('/').pop();
                if (t === blockTool) opt.selected = true;
                selector.appendChild(opt);
            });
            selector.addEventListener('change', function () {
                stream.setAttribute('tool', this.value);
                stream.save(function () {
                    tool.preview.state.onRefresh.handle.call(tool.preview, stream);
                });
            });
            controls.appendChild(selector);

            container.appendChild(controls);

            var body = document.createElement('div');
            body.className = 'Websites_block_body';

            // Title (for roles that use titles)
            var titleRoles = ['heading', 'feature', 'icon-feature', 'card',
                'stat', 'team-member', 'pricing-card', 'faq-item'];
            if (titleRoles.indexOf(role) >= 0 || title) {
                var tag = (role === 'heading') ? (attrs.tag || 'h2') : 'div';
                var titleEl = Q.Tool.setUpElement(tag, 'Streams/inplace', {
                    publisherId: ps.publisherId,
                    streamName: ps.streamName,
                    field: 'title',
                    inplaceType: 'text',
                    editable: true,
                    placeholder: tool._rolePlaceholder(role, 'title')
                }, null, tool.prefix);
                titleEl.className = 'Websites_block_title Websites_block_title_' + role;
                body.appendChild(titleEl);
            }

            // Content — render the selected tool
            var contentEl;
            if (blockTool === 'Streams/image/preview') {
                contentEl = Q.Tool.setUpElement('div', 'Streams/image/preview', {
                    publisherId: ps.publisherId,
                    streamName: ps.streamName,
                    editable: true,
                    imagepicker: { showSize: '400x', fullSize: '1000x' }
                }, null, tool.prefix);
            } else if (blockTool === 'Streams/markdown') {
                contentEl = Q.Tool.setUpElement('div', 'Streams/markdown', {
                    publisherId: ps.publisherId,
                    streamName: ps.streamName,
                    field: 'content',
                    editable: true,
                    livePreview: false,
                    placeholder: tool._rolePlaceholder(role, 'content')
                }, null, tool.prefix);
            } else if (blockTool === 'Streams/inplace') {
                contentEl = Q.Tool.setUpElement('div', 'Streams/inplace', {
                    publisherId: ps.publisherId,
                    streamName: ps.streamName,
                    field: 'content',
                    inplaceType: 'textarea',
                    editable: true,
                    placeholder: tool._rolePlaceholder(role, 'content')
                }, null, tool.prefix);
            } else {
                // Default: Streams/html (Froala)
                contentEl = Q.Tool.setUpElement('div', 'Streams/html', {
                    publisherId: ps.publisherId,
                    streamName: ps.streamName,
                    field: 'content',
                    editable: true,
                    placeholder: tool._rolePlaceholder(role, 'content'),
                    froala: {
                        toolbarInline: true,
                        charCounterCount: true,
                        charCounterMax: 4000,
                        toolbarButtons: [
                            'bold', 'italic', 'underline',
                            '|', 'formatOL', 'formatUL',
                            '|', 'insertLink', 'insertImage',
                            '|', 'paragraphFormat', 'clearFormatting'
                        ],
                        heightMin: 30
                    }
                }, null, tool.prefix);
            }
            contentEl.className = 'Websites_block_content';
            body.appendChild(contentEl);
            container.appendChild(body);

        } else {
            // View mode
            if (blockTool === 'Streams/image/preview') {
                var iconUrl = stream.iconUrl ? stream.iconUrl('400x') : '';
                if (iconUrl) {
                    var img = document.createElement('img');
                    img.className = 'Websites_block_view_img Websites_block_view_img_' + role;
                    img.src = iconUrl;
                    img.alt = title || '';
                    container.appendChild(img);
                }
            } else {
                if (title) {
                    var tag = (role === 'heading') ? (attrs.tag || 'h2') : 'h4';
                    var h = document.createElement(tag);
                    h.className = 'Websites_block_view_title Websites_block_view_title_' + role;
                    h.textContent = title;
                    container.appendChild(h);
                }
                if (content) {
                    var div = document.createElement('div');
                    div.className = 'Websites_block_view_content';
                    if (blockTool === 'Streams/markdown' && window.marked) {
                        div.innerHTML = marked.parse(content);
                    } else {
                        div.innerHTML = content;
                    }
                    container.appendChild(div);
                }
            }
        }

        Q.Tool.clear(tool.element);
        tool.element.innerHTML = '';
        tool.element.appendChild(container);
        Q.activate(tool.element, function () {
            Q.handle(tool.state.onRefresh, tool, [stream]);
            Q.handle(onLoad, tool);
        });
    },

    _rolePlaceholder: function (role, field) {
        var p = {
            heading:    { title: 'Heading text' },
            text:       { content: 'Write your content...' },
            content:    { content: 'Write your content...' },
            feature:    { title: 'Feature title', content: 'Feature description...' },
            'icon-feature': { title: 'Feature title', content: 'Feature description...' },
            card:       { title: 'Card title', content: 'Card description...' },
            stat:       { title: '100+', content: 'Stat label' },
            quote:      { content: '"Your testimonial here..."' },
            attribution: { content: '— Name, Title' },
            'testimonial-card': { title: 'Person Name', content: '"Testimonial..."' },
            'pricing-card': { title: 'Plan Name', content: '$X/mo — Feature list' },
            'team-member': { title: 'Name', content: 'Role / Title' },
            'faq-item':  { title: 'Question?', content: 'Answer...' },
            action:     { content: 'Button text' },
            sidebar:    { content: 'Sidebar content...' },
            nav:        { content: 'Link 1, Link 2, Link 3' },
            brand:      { content: 'Brand description...' },
            media:      { title: 'Image' },
            logo:       { title: 'Logo' }
        };
        return (p[role] || {})[field] || '';
    },

    composer: function () {
        var tool = this;
        var ps = tool.preview.state;
        var allowedTools = tool.state.allowedTools
            || Q.getObject('Websites.block.tools', Q) || [
                'Streams/html', 'Streams/markdown',
                'Streams/image/preview', 'Streams/inplace'
            ];

        ps.creatable.preprocess = function (proceed) {
            // Create block immediately with default tool
            proceed({
                title: '',
                content: '',
                attributes: JSON.stringify({
                    role: 'text',
                    tool: 'Streams/html'
                })
            });
        };
        return false;
    }
});

})(Q, Q.jQuery, window);
