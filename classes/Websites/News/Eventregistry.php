<?php

/**
 * @module Websites
 */

/**
 * EventRegistry (newsapi.ai) adapter.
 *
 * Normalizes EventRegistry responses into provider-agnostic article items.
 *
 * @class Websites_News_Eventregistry
 */
class Websites_News_Eventregistry extends Websites_News implements Websites_News_Interface
{
	protected $apiKey;
	protected $endpoint = 'https://eventregistry.org/api/v1/article/getArticles';

	protected static $languages = null;
	protected static $countries = null;

	public function __construct($options = array())
	{
		// Supports adapter factory passing key
		if (is_string($options) && $options) {
			$this->apiKey = $options;
		} else {
			$this->apiKey = Q_Config::expect('Websites', 'eventregistry', 'key');
		}
	}

	public function fetchNews(array $options = array())
	{
		$opts = Q::take($options, array(
			'type'     => 'top',
			'country'  => 'us',
			'language' => 'en',
			'keyword'  => null,
			'max'      => 12,
			'page'     => 1
		));

		if ($opts['type'] === 'search' && !$opts['keyword']) {
			throw new Q_Exception_RequiredField(array(
				'field' => 'options.keyword'
			));
		}

		$body = array(
			'action'                 => 'getArticles',
			'resultType'             => 'articles',
			'articlesPage'           => (int) $opts['page'],
			'articlesCount'          => min(100, max(1, (int) $opts['max'])),
			'articlesSortBy'         => 'date',
			'articlesSortByAsc'      => false,
			'dataType'               => array('news'),
			'forceMaxDataTimeWindow' => 31,
			'includeArticleBody'     => true,
			'includeArticleImage'    => true,
			'includeSourceTitle'     => true,
			'apiKey'                 => $this->apiKey
		);

		if ($opts['keyword']) {
			$body['keyword'] = $opts['keyword'];
		}

		if ($opts['language']) {
			$iso3 = $this->iso3($opts['language']);
			if ($iso3) {
				$body['lang'] = $iso3;
			}
		}

		if ($opts['country']) {
			$uri = $this->countryUri($opts['country']);
			if ($uri) {
				$body['sourceLocationUri'] = array($uri);
			}
		}

		$headers = array(
			'Content-Type: application/json'
		);

		$response = Q_Utils::post(
			$this->endpoint,
			json_encode($body),
			null,
			array(),
			$headers,
			30
		);

		$data = Q::json_decode($response, true);

		if (!is_array($data) || empty($data['articles']['results'])) {
			Q::log('EventRegistry error or empty result: ' . $response);
			return array();
		}

		$items = array();
		foreach ($data['articles']['results'] as $a) {
			$items[] = $this->normalize($a, $opts['language'], $opts['country']);
		}

		return $items;
	}

	protected function normalize(array $a, $language, $country)
	{
		$item = Q::take($a, array(
			'uri'         => null,
			'url'         => null,
			'title'       => null,
			'body'        => null,
			'image'       => null,
			'dateTimePub' => null
		), $dest = array(), array(
			'body'        => 'summary',
			'image'       => 'image',
			'dateTimePub' => 'publishedAt'
		));

		$item['id'] = $item['uri'];
		unset($item['uri']);

		$item['source'] = Q::take(Q::ifset($a, 'source', array()), array(
			'title' => null,
			'uri'   => null
		), $src = array(), array(
			'title' => 'name',
			'uri'   => 'url'
		));

		$item['language'] = $language;
		$item['country']  = $country;
		$item['keywords'] = array();

		return $item;
	}

	/**
	 * Convert ISO-2 → ISO-3 using Q/languages.json
	 */
	protected function iso3($iso2)
	{
		$iso2 = strtolower($iso2);

		if (!self::$languages) {
			$file = Q_FILES_DIR . DS . 'Q' . DS . 'languages.json';
			$tree = Q_Tree::createAndLoad($file);
			self::$languages = $tree->getAll();
		}

		foreach (self::$languages as $code => $info) {
			if (strtolower(Q::ifset($info, 'ISO-639-1', '')) === $iso2) {
				return strtolower(Q::ifset($info, 'ISO-639-2B', null));
			}
		}

		return null;
	}

	/**
	 * Convert ISO-2 country → Wikipedia URI using Places/countries
	 */
	protected function countryUri($cc)
	{
		$cc = strtoupper($cc);

		if (!self::$countries) {
			self::$countries = Q_Text::get('Places/countries', array(
				'language' => 'en'
			));
		}

		$name = Q::ifset(self::$countries, $cc, 0, null);
		if (!$name) return null;

		$name = str_replace(' ', '_', $name);

		return 'http://en.wikipedia.org/wiki/' . $name;
	}
}