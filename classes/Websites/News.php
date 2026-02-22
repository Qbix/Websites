<?php

/**
 * @module Websites
 */

/**
 * Provider interface for news adapters.
 *
 * Adapters normalize provider-specific API responses into a common
 * provider-agnostic article format.
 *
 * @class Websites_News_Interface
 */
interface Websites_News_Interface
{
	/**
	 * Fetch normalized news items from a provider.
	 *
	 * Implementations should return an array of normalized article items
	 * with keys such as: id, url, title, summary, content, image,
	 * publishedAt, source, language, country, keywords.
	 *
	 * @method fetch
	 * @param {array} $options Provider-agnostic options
	 * @return {array} Normalized article items
	 */
	public function fetch(array $options = array());
}

/**
 * @module Websites
 */

/**
 * Provider-agnostic news fetcher and Stream upserter.
 *
 * Coordinates adapter selection, fetch policy (idempotent daily fetch),
 * optional LLM enrichment, and canonical Stream creation.
 *
 * @class Websites_News
 */
class Websites_News
{
	/**
	 * Fetch news articles using provider-agnostic options.
	 *
	 * Default behavior:
	 * - Idempotent per day: if today's Streams already exist for the given
	 *   (language, country), this returns existing Streams and does NOT
	 *   call the external API.
	 * - Pass `force => true` to always refetch from the provider.
	 *
	 * @method fetch
	 * @static
	 * @param {array} $options
	 * @param {string}  [$options.type="top"]       "top" | "search"
	 * @param {string}  [$options.keyword]          Keyword query when type="search"
	 * @param {string}  [$options.country="us"]     ISO-2 country code
	 * @param {string}  [$options.language="en"]    ISO-2 language code
	 * @param {integer} [$options.max=12]           Max number of articles
	 * @param {string}  [$options.from]             YYYY-MM-DD (search only)
	 * @param {string}  [$options.to]               YYYY-MM-DD (search only)
	 * @param {string}  [$options.category]         Category (best-effort)
	 * @param {string}  [$options.sources]          Source filter (best-effort)
	 * @param {boolean} [$options.createStreams=true] Create/update Streams entries
	 * @param {boolean} [$options.force=false]      Force refetch even if today's Streams exist
	 * @param {string|object} [$options.llm]        LLM adapter name or instance (e.g. "openai")
	 * @return {array} Streams_Stream[] OR raw items (if createStreams=false)
	 */
	static function fetch(array $options = array())
	{
		$provider = Q_Config::get('Websites', 'news', 'provider', 'gnews');

		$type     = Q::ifset($options, 'type', 'top');
		$country  = Q::ifset($options, 'country', 'us');
		$language = Q::ifset($options, 'language', 'en');
		$keyword  = Q::ifset($options, 'keyword', null);
		$max      = (int) Q::ifset($options, 'max', 12);
		$create   = Q::ifset($options, 'createStreams', true);
		$force    = Q::ifset($options, 'force', false);

		// Idempotent daily guard: return existing Streams unless forced
		if (!$force && $create) {
			$today = gmdate('Y-m-d');

			$criteria = array(
				array('attribute/publishedAt' => array($today, true, false, null))
			);

			if ($language) {
				list($lang) = explode('-', $language);
				$criteria[] = array(
					'attribute/language' => array('filter' => array($lang))
				);
			}

			if ($country) {
				$criteria[] = array(
					'attribute/country' => array('filter' => array($country))
				);
			}

			$existing = Streams::related(
				Q::app(),
				Q::app(),
				'Streams/category/webpages',
				true,
				array(
					'prefix'          => 'Websites/webpage/',
					'limit'           => 1,
					'skipAccess'      => true,
					'streamsOnly'     => true,
					'criteria'        => $criteria,
					'constrainFacets' => true
				)
			);

			if (!empty($existing)) {
				return $existing;
			}
		}

		$adapter = self::adapter($provider);

		$items = $adapter->fetch(array_merge($options, array(
			'type'     => $type,
			'country'  => $country,
			'language' => $language,
			'keyword'  => $keyword,
			'max'      => $max
		)));

		if (!$create) {
			return $items;
		}

		$streams = array();
		foreach ($items as $item) {
			$s = self::upsertArticleStream($item, $options);
			if ($s) $streams[] = $s;
		}

		return $streams;
	}

	/**
	 * Adapter factory.
	 *
	 * Resolves provider name to a concrete adapter class and enforces
	 * Websites_News_Interface.
	 *
	 * @method adapter
	 * @protected
	 * @static
	 * @param {string} $provider Provider name (e.g. "gnews")
	 * @return {Websites_News_Interface}
	 * @throws Q_Exception_RequiredField
	 * @throws Q_Exception_MethodNotSupported
	 */
	protected static function adapter(string $provider)
	{
		if (!$provider) {
			throw new Q_Exception_RequiredField(array(
				'field' => 'provider'
			));
		}

		// Normalize: lowercase -> ucfirst segments -> Websites_News_<Provider>
		$sanitized = preg_replace('/[^a-z0-9]+/i', ' ', (string) $provider);
		$suffix    = str_replace(' ', '', ucwords(strtolower($sanitized)));
		$className = "Websites_News_{$suffix}";

		if (!class_exists($className)) {
			throw new Q_Exception_MethodNotSupported(array(
				'method' => $className
			));
		}

		// Resolve API key from config using provider name
		$key = Q_Config::get('Websites', 'news', strtolower($provider) . 'ApiKey', null);

		// Instantiate adapter; constructor signature may vary by adapter
		$adapter = ($key !== null)
			? new $className($key)
			: new $className(array());

		// Enforce interface
		if (!($adapter instanceof Websites_News_Interface)) {
			throw new Q_Exception_MethodNotSupported(array(
				'method' => $className . ' must implement Websites_News_Interface'
			));
		}

		return $adapter;
	}

	/**
	 * Create or update canonical Stream for a normalized article item.
	 *
	 * Persists attributes, title/content, and imports the article image
	 * as the Stream icon when available.
	 *
	 * @method upsertArticleStream
	 * @protected
	 * @static
	 * @param {array} $item Normalized article item
	 * @param {array} $options Fetch options
	 * @return {Streams_Stream|null}
	 */
	protected static function upsertArticleStream(array $item, array $options)
	{
		$url = Q::ifset($item, 'url', null);
		if (!$url) return null;

		// Extract core attributes using Q::take
		$attributes = Q::take($item, array(
			'source'      => null,
			'language'    => Q::ifset($options, 'language', 'en'),
			'country'     => Q::ifset($options, 'country', null),
			'category'    => Q::ifset($options, 'category', null),
			'publishedAt' => null
		));

		// Normalize keywords if present
		if (!empty($item['keywords']) && is_array($item['keywords'])) {
			$attributes['keywords'] = array_values(array_unique($item['keywords']));
		}

		// Optional LLM keyword enrichment (single call)
		if (empty($attributes['keywords']) && !empty($item['title'])) {
			$llm = AI_LLM::create(Q::ifset($options, 'llm', null));
			if ($llm) {
				$native = null;
				try {
					$attributes['keywords'] = $llm->keywords(
						array($item['title']),
						'insert',
						array(
							'language' => Q::ifset($options, 'language', 'en')
						),
						$native
					);
					if (!empty($native)) {
						$attributes['keywordsNative'] = $native;
					}
				} catch (Exception $e) {
					// Best-effort enrichment; failures are non-fatal
				}
			}
		}

		$stream = Websites_Webpage::createStream(array(
			'url'         => $url,
			'asUserId'    => Q::app(),
			'publisherId' => Q::app(),
			'attributes'  => $attributes
		), null, true);

		if (!$stream) return null;

		if (!empty($item['title'])) {
			$stream->title = mb_substr($item['title'], 0, $stream->maxSize_title(), 'UTF-8');
		}
		if (!empty($item['summary'])) {
			$stream->content = mb_substr($item['summary'], 0, $stream->maxSize_content(), 'UTF-8');
		}

		$stream->save();

		if (!empty($item['image'])) {
			try {
				Streams::importIcon($stream->publisherId, $stream->name, $item['image'], 'Websites/image');
			} catch (Exception $e) {}
		}

		return $stream;
	}

	/**
	 * Handle push notification scheduling for fetched items.
	 *
	 * Default implementation throws; providers may override behavior
	 * via subclassing if needed.
	 *
	 * @method handlePushNotification
	 * @protected
	 * @param {array} $notifications
	 * @param {array} $options
	 * @throws Q_Exception_MethodNotSupported
	 */
	protected function handlePushNotification($notifications, $options = array())
	{
		throw new Q_Exception_MethodNotSupported(array(
			'method' => 'handlePushNotification'
		));
	}
}