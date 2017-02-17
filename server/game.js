/*
 * Server side game module. Maintains the game state and processes all the messages from clients.
 *
 * Exports:
 *   - addPlayer(name)
 *   - move(direction, name)
 *   - state()
 */

const { clamp, randomPoint, permutation } = require('./gameutil');

const WIDTH = 64;
const HEIGHT = 64;
const MAX_PLAYER_NAME_LENGTH = 32;
const NUM_COINS = 100;
const PLAYER_LIFETIME = 300;


// A KEY-VALUE "DATABASE" FOR THE GAME STATE.
//
// The game state is maintained in an object. Your homework assignment is to swap this out
// for a Redis database.
//
// In this version, the players never die. For homework, you need to make a player die after
// five minutes of inactivity. You can use the Redis TTL for this.
//
// Here is how the storage is laid out:
//
// player:<name>    string       "<row>,<col>"
// scores           sorted set   playername with score
// coins            hash         { "<row>,<col>": coinvalue }
// usednames        set          all used names, to check quickly if a name has been used
//

// const database = {
//   scores: {},
//   usednames: new Set(),
//   coins: {},
// };

const redis = require('redis');
const client = redis.createClient();

exports.addPlayer = (name, callback) => {
    client.sismember('usednames', name, (err, reply) => {
        if (err) {
            return callback(err);
        }
        if (name.length === 0 || name.length > MAX_PLAYER_NAME_LENGTH || reply) {
            return callback(null, false);
        }
        const multi = client.multi();
        multi.sadd('usednames', name);
        multi.set('player:' + name, randomPoint(WIDTH, HEIGHT).toString());
        multi.zadd('scores', 0, name);
        multi.expire('player:' + name, PLAYER_LIFETIME);
        multi.exec((err, reply) => {
            if (err) {
                return callback(err);
            }
            // return callback(null, !!(reply.reduce((accumulator, current) => {
            //     accumulator && current;
            // })));
            return callback(null, !!reply.reduce((accumulator, current) => accumulator && current));
        });
        return null;
    });
};

function placeCoins() {
  permutation(WIDTH * HEIGHT).slice(0, NUM_COINS).forEach((position, i) => {
    const coinValue = (i < 50) ? 1 : (i < 75) ? 2 : (i < 95) ? 5 : 10;
    const index = `${Math.floor(position / WIDTH)},${Math.floor(position % WIDTH)}`;
    // database.coins[index] = coinValue;
    client.hsetnx('coins', index, coinValue);

  });
}

// Return only the parts of the database relevant to the client. The client only cares about
// the positions of each player, the scores, and the positions (and values) of each coin.
// Note that we return the scores in sorted order, so the client just has to iteratively
// walk through an array of name-score pairs and render them.

// TODO figure out why Toal hardcoded a 7...

const TOALS_SUBSTRING_LENGTH = 7;

exports.state = (callback) => {
  // const positions = Object.entries(database)
  const positions = {};
  client.keys('player:*', (err, names) => {
      if (err) {
          return err;
      }
      client.mget(names, (err, values) => {
         if (err) {
             return err;
         }
         names.forEach((name, index) => {
             positions[name.substring(TOALS_SUBSTRING_LENGTH)] = values[index];
         });
         client.zrevrange('scores', 0, -1, 'withscores', (err, namesAndScores) => {
             const scores = [];
             for (let i = 0; i < namesAndScores.length; i += 2) {
                 scores.push([ namesAndScores[i], namesAndScores[i + 1] ]);
             }
             client.hgetall('coins', (err, coins) => {
                 if (err) {
                     return err;
                 }
                 if (coins) {
                     return callback(null, { positions, scores, coins });
                 }
             });
             return null;
         });
         return null;
      });
      return null;
  });
  return null;
  //   .filter(([key]) => key.startsWith('player:'))
  //   .map(([key, value]) => [key.substring(7), value]);
  // const scores = Object.entries(database.scores);
  // scores.sort(([, v1], [, v2]) => v1 < v2);
  // return {
  //   positions,
  //   scores,
  //   coins: database.coins,
  // };
};

exports.move = (direction, name, callback) => {
  const delta = { U: [0, -1], R: [1, 0], D: [0, 1], L: [-1, 0] }[direction];
  if (delta) {
    client.get('player:' + name, (err, reply) => {
        if (err) {
            return callback(err);
        }
        if (reply) {
            const [x, y] = reply.split(',');
            const [newX, newY] = [clamp(+x + delta[0], 0, WIDTH - 1), clamp(+y + delta[1], 0, HEIGHT - 1)];
            client.hget('coins', `${newX},${newY}`, (err, reply) => {
                if (err) {
                    return callback(err);
                }
                if (reply) {
                    client.zincrby('scores', reply, name);
                    client.hdel('coins', `${newX},${newY}`);
                }
                client.set('player:' + name, `${newX},${newY}`);
                client.expire('player:' + name,  PLAYER_LIFETIME);

                // When all coins collected, generate a new batch.
                client.hlen('coins', (err, reply) => {
                    if (err) {
                        return callback(err);
                    }
                    if (reply === 0) {
                        placeCoins();
                        return callback(null, true);
                    }
                    return callback(null, true);
                });
                return null;
            });
        } else {
            client.del('player:' + name);
            client.zrem('scores', name);
            client.srem('usednames', name);
            console.log('you are dead.');
        }
        return null;
    });
    // const playerKey = `player:${name}`;
    // const [x, y] = database[playerKey].split(',');
    // const [newX, newY] = [clamp(+x + delta[0], 0, WIDTH - 1), clamp(+y + delta[1], 0, HEIGHT - 1)];
    // const value = database.coins[`${newX},${newY}`];
    // if (value) {
    //   database.scores[name] += value;
    //   delete database.coins[`${newX},${newY}`];
    // }
    // database[playerKey] = `${newX},${newY}`;
    //
    // // When all coins collected, generate a new batch.
    // if (Object.keys(database.coins).length === 0) {
    //   placeCoins();
    // }
  }
};

placeCoins();
