import React, { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  Avatar,
  Button,
  Car,
  colors,
  Icon,
  km,
  mins,
  money,
  Route,
  s,
  tr,
} from "./ui";
import { Order, User } from "./types";

export const statusText = {
  SEARCHING: "Ищем водителя",
  ASSIGNED: "Водитель выехал к вам",
  ARRIVED: "Водитель приехал",
  IN_PROGRESS: "Поездка началась",
  COMPLETED: "Заказ успешно выполнен",
  CANCELLED: "Заказ отменён",
  NO_DRIVER: "Водитель не найден",
};
export function TripPanel({
  order,
  user,
  busy,
  onAction,
  onChat,
  onDone,
  onRating,
  coming,
}: {
  order: Order;
  user: User;
  busy: boolean;
  onAction: (action: string) => void;
  onChat: () => void;
  onDone: () => void;
  onRating: (score: number) => void;
  coming: boolean;
}) {
  const t = tr(user.language);
  const driver = user.role === "DRIVER";
  const [score, setScore] = useState(0);
  const other = driver ? order.client : order.driver;
  const vehicle = order.driver?.driverProfile;
  const terminal = ["COMPLETED", "CANCELLED", "NO_DRIVER"].includes(
    order.status,
  );
  const title = driver
    ? (
        {
          ASSIGNED: "Следуйте к пассажиру",
          ARRIVED: "Ожидайте пассажира",
          IN_PROGRESS: "Поездка началась",
        } as Record<string, string>
      )[order.status] || statusText[order.status]
    : statusText[order.status];
  const call = () => other?.phone && void Linking.openURL(`tel:${other.phone}`);
  if (terminal && order.status !== "COMPLETED")
    return (
      <>
        <View style={{ alignItems: "center", gap: 12, paddingVertical: 15 }}>
          <View style={s.emptyIcon}>
            <Icon
              name={order.status === "NO_DRIVER" ? "car-outline" : "close"}
              color={colors.blue}
              size={34}
            />
          </View>
          <Text style={[s.h2, { textAlign: "center" }]}>{t(title)}</Text>
          <Text style={[s.muted, { textAlign: "center" }]}>
            {t(
              order.status === "NO_DRIVER"
                ? "Сейчас нет свободных водителей. Попробуйте ещё раз."
                : "Вы можете оформить новую поездку.",
            )}
          </Text>
        </View>
        <Route order={order} t={t} />
        <Button label={t("Заказать снова")} onPress={onDone} />
      </>
    );
  return (
    <>
      {order.status === "SEARCHING" && (
        <View style={{ alignItems: "center", paddingTop: 8 }}>
          <View
            style={{
              width: 96,
              height: 96,
              borderWidth: 5,
              borderColor: "#E3F0FF",
              borderRadius: 48,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Car size={58} />
            <ActivityIndicator
              style={{ position: "absolute", right: -7, bottom: 1 }}
              color={colors.blue}
            />
          </View>
        </View>
      )}
      {order.status === "COMPLETED" && (
        <View style={{ alignItems: "center" }}>
          <View style={[s.emptyIcon, { backgroundColor: colors.blue }]}>
            <Icon name="checkmark" color="white" size={42} />
          </View>
        </View>
      )}
      <View style={{ gap: 5 }}>
        <Text style={[s.h2, { textAlign: "center" }]}>{t(title)}</Text>
        {order.status === "SEARCHING" && (
          <Text style={[s.muted, { textAlign: "center" }]}>
            {t("Предлагаем заказ свободным водителям")}
          </Text>
        )}
        {order.status === "COMPLETED" && (
          <Text style={[s.muted, { textAlign: "center" }]}>
            {t("Спасибо, что выбрали Taxi GO")}
          </Text>
        )}
        {order.status === "ARRIVED" && vehicle && (
          <Text style={[s.muted, { textAlign: "center" }]}>
            {vehicle.carColor} {vehicle.carMake} · {vehicle.carPlate}
          </Text>
        )}
      </View>
      {other && !terminal && (
        <View style={[s.row, { paddingVertical: 5 }]}>
          <Avatar user={other} size={64} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.h3}>
              {other.name || t(driver ? "Пассажир" : "Водитель")}
            </Text>
            {vehicle && !driver && (
              <>
                <Text style={s.muted}>
                  {vehicle.carColor} {vehicle.carMake}
                </Text>
                <View style={s.row}>
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: 8,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 15,
                        fontWeight: "700",
                        color: colors.ink,
                      }}
                    >
                      {vehicle.carPlate}
                    </Text>
                  </View>
                  {vehicle.rating != null && (
                    <Text style={{ color: colors.ink, fontWeight: "600" }}>
                      ★ {Number(vehicle.rating).toFixed(1)}
                    </Text>
                  )}
                </View>
              </>
            )}
          </View>
          {!driver && <Car size={64} />}
        </View>
      )}
      {(order.status === "SEARCHING" ||
        order.status === "IN_PROGRESS" ||
        terminal ||
        driver) && (
        <View style={[s.card, { padding: 14 }]}>
          <Route order={order} t={t} />
          <View
            style={[
              s.spread,
              {
                marginTop: 17,
                borderTopWidth: 1,
                borderTopColor: colors.line,
                paddingTop: 12,
              },
            ]}
          >
            <Text style={s.muted}>
              {km(order.distanceMeters)} · ≈{" "}
              {mins(order.durationSeconds, user.language)}
            </Text>
            <Text style={[s.h3, { color: colors.blue }]}>
              {money(order.price)}
            </Text>
          </View>
        </View>
      )}
      {order.comment && driver && (
        <View
          style={[
            s.row,
            { backgroundColor: colors.pale, padding: 13, borderRadius: 14 },
          ]}
        >
          <Icon name="chatbox-outline" />
          <Text style={[s.body, { flex: 1 }]}>{order.comment}</Text>
        </View>
      )}
      {other && !terminal && (
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Button
              secondary
              icon="call"
              label={t("Позвонить")}
              disabled={!other.phone}
              onPress={call}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              secondary
              icon="chatbubble-ellipses"
              label={t("Чат")}
              onPress={onChat}
            />
          </View>
        </View>
      )}
      {driver && coming && !terminal && (
        <Text
          style={{
            color: colors.green,
            textAlign: "center",
            fontWeight: "600",
          }}
        >
          {t("Пассажир выходит")}
        </Text>
      )}
      {!driver && order.status === "ARRIVED" && (
        <Button
          label={t(coming ? "Уже отправлено" : "Я выхожу")}
          onPress={() => onAction("coming")}
          disabled={coming}
          busy={busy}
        />
      )}
      {driver &&
        ["ASSIGNED", "ARRIVED", "IN_PROGRESS"].includes(order.status) && (
          <Button
            label={t(
              (
                {
                  ASSIGNED: "Приехал",
                  ARRIVED: "Начать поездку",
                  IN_PROGRESS: "Завершить поездку",
                } as Record<string, string>
              )[order.status],
            )}
            onPress={() =>
              onAction(
                (
                  {
                    ASSIGNED: "arrive",
                    ARRIVED: "start",
                    IN_PROGRESS: "complete",
                  } as Record<string, string>
                )[order.status],
              )
            }
            busy={busy}
          />
        )}
      {!terminal && order.status !== "IN_PROGRESS" && (
        <Button
          secondary
          label={t("Отменить заказ")}
          onPress={() => onAction("cancel")}
          busy={busy}
        />
      )}
      {order.status === "COMPLETED" && (
        <>
          <View
            style={[
              s.spread,
              { backgroundColor: colors.pale, padding: 15, borderRadius: 18 },
            ]}
          >
            <View style={s.row}>
              <Icon name="cash-outline" color={colors.green} />
              <View>
                <Text style={s.h3}>{t("Наличные")}</Text>
                <Text style={s.caption}>{t("Оплата водителю")}</Text>
              </View>
            </View>
            <Text style={s.h2}>{money(order.price)}</Text>
          </View>
          {!driver && !order.rating && (
            <View
              style={{
                alignItems: "center",
                backgroundColor: colors.pale,
                padding: 17,
                borderRadius: 21,
                gap: 10,
              }}
            >
              <Text style={s.h3}>{t("Оцените поездку")}</Text>
              <View style={s.row}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Pressable
                    key={value}
                    accessibilityLabel={`${t("Оценка")} ${value}`}
                    accessibilityRole="button"
                    onPress={() => setScore(value)}
                  >
                    <Icon
                      name={value <= score ? "star" : "star-outline"}
                      color={value <= score ? colors.blue : "#B6C5D9"}
                      size={35}
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          )}
          <Button
            label={t("Готово")}
            busy={busy}
            onPress={() =>
              !driver && score && !order.rating ? onRating(score) : onDone()
            }
          />
        </>
      )}
    </>
  );
}
