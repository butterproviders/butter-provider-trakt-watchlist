var _ = require('lodash');
var debug = require('debug')('trakt:watchlist');
var moment = require('moment');
var localStorage = localStorage || require('localStorage');
var Trakt = require('trakt.tv');

var Watchlist = function (args) {
    args = args || {}
    this.cacheTime = args.cacheTime || 14400000;
    this.trakt = args.trakt || new Trakt({
        client_id: args.id || '647c69e4ed1ad13393bf6edd9d8f9fb6fe9faf405b44320a6b71ab960b4540a2',
        client_secret: args.secret || 'f55b0a53c63af683588b47f6de94226b7572a6f83f40bd44c58a7c83fe1f2cb1',
        plugins: ['ondeck']
    });

    this.trakt.checkButterIsAuth = args.checkTrakt || function () {
        console.error("you did not supply a trakt auth function")
    };
};

Watchlist.prototype.constructor = Watchlist;
Watchlist.prototype.config = {
    name: 'Watchlist'
};

var rearrange = function (items) {
    var no_arrange = [],
        arrange = [],
        arranged;

    return Promise.all(items.map(function (item) {
        if (item) {
            if (item.first_aired) {
                arrange.push(item);
            } else {
                no_arrange.push(item);
            }
        }
    })).then(function () {
        arranged = arrange.sort(function(a, b){
            if(a.episode_aired > b.episode_aired) {
                return -1;
            }
            if(a.episode_aired < b.episode_aired) {
                return 1;
            }
            return 0;
        });
        debug('rearranged shows by air date');//debug
        return arranged.concat(no_arrange);
    });
};

var format = function (items) {
    var itemList = [];
    debug('format'); //debug

    return Promise.all(items.map(function (item) {
        if (item.next_episode) {
            if(moment(item.next_episode.first_aired).fromNow().indexOf('in') !== -1) {
                console.warn('"%s" is not released yet, not showing', item.show.title + ' ' + item.next_episode.season + 'x' + item.next_episode.number);
            } else {
                var show = item.show;
                show.type = 'show';
                show.episode = item.next_episode.number;
                show.season = item.next_episode.season;
                show.episode_title = item.next_episode.title;
                show.episode_id = item.next_episode.ids.tvdb;
                show.episode_aired = item.next_episode.first_aired;
                show.imdb_id = item.show.ids.imdb;
                show.tvdb_id = item.show.ids.tvdb;
                show.image = item.show.images.poster.thumb;
                show.rating = item.show.rating;
                show.title = item.show.title;
                show.trailer = item.show.trailer;

                itemList.push(show);
            }
        } else {
            if (!item.movie) {
                debug('item is not a movie', item); //debug
            } else {
                if(moment(item.movie.released).fromNow().indexOf('in') !== -1) {
                    console.warn('"%s" is not released yet, not showing', item.movie.title);
                } else {
                    var movie = item.movie;
                    movie.type = 'movie';
                    movie.imdb_id = item.movie.ids.imdb;
                    movie.rating = item.movie.rating;
                    movie.title = item.movie.title;
                    movie.trailer = item.movie.trailer;
                    movie.year = item.movie.year;
                    movie.image = item.movie.images.poster.thumb;

                    itemList.push(movie);
                }
            }
        }
    })).then(function () {
        return itemList;
    });
};

Watchlist.prototype._load = function () {
    var that = this;
    delete localStorage.watchlist_fetched_time;
    delete localStorage.watchlist_cached;
    delete localStorage.watchlist_update_shows;
    delete localStorage.watchlist_update_movies;

    var watchlist = [];

    return that.trakt.ondeck.getAll().then(function (tv) {
        debug('shows fetched'); //debug
        // store update data
        localStorage.watchlist_update_shows = JSON.stringify(tv);

        // add tv show to watchlist
        watchlist = watchlist.concat(tv.shows);

        return that.trakt.sync.watchlist.get({
            extended: 'full,images',
            type: 'movies'
        });
    }).then(function (movies) {
        debug('movies fetched'); //debug

        // store update data
        localStorage.watchlist_update_movies = JSON.stringify(movies);

        // add movies to watchlist
        watchlist = watchlist.concat(movies);

        return format(watchlist);
    }).then(rearrange).then(function (items) {
        // store fetched timestamp
        localStorage.watchlist_fetched_time = Date.now();

        // cache watchlist
        localStorage.watchlist_cached = JSON.stringify(items);

        return {
            results: items,
            hasMore: false
        };
    });
};

Watchlist.prototype._update = function (id) {
    var that = this;
    var update_data = JSON.parse(localStorage.watchlist_update_shows);
    delete localStorage.watchlist_fetched_time;
    delete localStorage.watchlist_cached;
    delete localStorage.watchlist_update_shows;

    var watchlist = [];

    return that.trakt.ondeck.updateOne(update_data, id).then(function (tv) {
        debug('shows updated'); //debug
        // store update data
        localStorage.watchlist_update_shows = JSON.stringify(tv);

        // add tv show & movies to watchlist
        watchlist = JSON.parse(localStorage.watchlist_update_movies).concat(tv.shows);

        return format(watchlist);
    }).then(rearrange).then(function (items) {
        // store fetched timestamp
        localStorage.watchlist_fetched_time = Date.now();

        // cache watchlist
        localStorage.watchlist_cached = JSON.stringify(items);

        return {
            results: items,
            hasMore: false
        };
    });
};

Watchlist.prototype.extractIds = function (items) {
    return _.pluck(items, 'imdb_id');
};

Watchlist.prototype.detail = function (torrent_id, old_data, callback) {
    return {};
};

Watchlist.prototype.fetch = function (filters) {
    var that = this;
    return new Promise(function (resolve, reject) {
        if (filters && typeof filters !== 'function' && (filters.force || filters.update)) {
            if (filters.update && localStorage.watchlist_update_shows) {
                console.error('Watchlist - update one item');
                return that._update(filters.update).then(resolve).catch(reject);
            } else {
                if (filters.force) {
                    console.error('Watchlist - force reload');
                    return that._load().then(resolve).catch(reject);
                } else {
                    console.error('Watchlist - this should not be called', filters);
                    reject('SHOULDNT BE CALLED');
                }
            }
        } else {
            // cache is 4 hours
            if (!localStorage.watchlist_cached || localStorage.watchlist_fetched_time + that.cacheTime < Date.now()) {
                console.error('Watchlist - no watchlist cached or cache expired');
                if (that.trakt._authentication && that.trakt._authentication.access_token) {
                    return that.fetch({force:true}).then(resolve).catch(reject);
                } else {
                    reject('Trakt not authenticated');
                }
            } else {
                console.error('Watchlist - return cached');
                resolve({
                    results: JSON.parse(localStorage.watchlist_cached),
                    hasMore: false
                });
            }
        }  
    });
};

module.exports = Watchlist;
