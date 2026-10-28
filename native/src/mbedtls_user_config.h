/* mbedTLS 2.28 adjustments for Native Client (newlib, Pepper sockets) */
#undef MBEDTLS_NET_C                 /* sockets come from Pepper (pp::TCPSocket) */
#undef MBEDTLS_TIMING_C
#undef MBEDTLS_FS_IO                 /* no filesystem in the NaCl sandbox */
#undef MBEDTLS_PSA_CRYPTO_C
#undef MBEDTLS_PSA_CRYPTO_STORAGE_C
#undef MBEDTLS_PSA_ITS_FILE_C
#undef MBEDTLS_ENTROPY_C             /* ctr_drbg is seeded from nacl-irt-random */
#undef MBEDTLS_SSL_PROTO_TLS1        /* TLS 1.2 only */
#undef MBEDTLS_SSL_PROTO_TLS1_1
#undef MBEDTLS_SSL_PROTO_DTLS
#undef MBEDTLS_SSL_DTLS_HELLO_VERIFY
#undef MBEDTLS_SSL_DTLS_ANTI_REPLAY
#undef MBEDTLS_SSL_DTLS_BADMAC_LIMIT
#undef MBEDTLS_SSL_DTLS_CLIENT_PORT_REUSE
#undef MBEDTLS_SSL_DTLS_CONNECTION_ID
#undef MBEDTLS_SSL_SRV_C             /* client only */
#undef MBEDTLS_SSL_COOKIE_C
#undef MBEDTLS_SSL_TICKET_C
#undef MBEDTLS_SSL_CACHE_C
#undef MBEDTLS_SELF_TEST
#undef MBEDTLS_PKCS12_C
#undef MBEDTLS_PKCS5_C
#undef MBEDTLS_SSL_CBC_RECORD_SPLITTING /* TLS 1.0 only */
