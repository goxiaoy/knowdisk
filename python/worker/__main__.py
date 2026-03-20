from worker.runtime import bootstrap


def main() -> None:
    try:
        bootstrap.main()
    except KeyboardInterrupt:
        raise SystemExit(130) from None


if __name__ == "__main__":
    main()
